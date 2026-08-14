import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { asyncJobs } from "../../../db/schema";

// Background-job bookkeeping for AI work that can legitimately take
// several minutes (content-plan generation today) — too long to trust a
// single HTTP request to stay open end to end, since a hosting platform's
// reverse proxy enforces its own timeout independent of the app (this is
// what "AI-редакция вернула пустой ответ" turning into a raw "failed to
// fetch" after a token-budget increase turned out to be: the proxy, not
// OpenAI or this server, giving up on a slow-but-otherwise-fine request).
//
// Why "just don't await it" is safe here specifically: this app runs on
// Render as a persistent `next start` Node process (render.yaml, plan:
// starter), not a serverless function that gets frozen or recycled the
// moment an HTTP response is sent. A promise kept running after
// `Response.json(...)` returns from a route handler keeps executing
// normally as long as the process stays alive and the event loop has
// work to do — which it does here, since the promise chain itself is
// that work. This would NOT be safe on a serverless platform (Vercel,
// Lambda) without an explicit keep-alive mechanism (e.g. `waitUntil`);
// don't copy this pattern there without adding one.

export type AsyncJobStatus = "pending" | "processing" | "done" | "failed";

export async function createAsyncJob(kind: string, ownerEmail: string, input: unknown) {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(asyncJobs).values({
    id,
    ownerEmail,
    kind,
    status: "pending",
    inputJson: JSON.stringify(input),
  });
  // Opportunistic cleanup instead of a cron job: every new job takes the
  // chance to drop this owner's own jobs from over a day ago. Cheap (one
  // indexed delete), keeps the table from growing forever, and never
  // touches another user's rows or a job that might still be running.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.delete(asyncJobs).where(and(
    eq(asyncJobs.ownerEmail, ownerEmail),
    lt(asyncJobs.createdAt, oneDayAgo),
  )).catch((error) => {
    console.error("async job cleanup failed (non-fatal)", error);
  });
  return id;
}

// The browser can resend a POST after a network hiccup, be open in two tabs,
// or let a person press the action again after a long wait.  A content-plan
// job is expensive, so the route reuses the owner's already active job
// instead of starting a second identical provider call.
export async function findActiveAsyncJob(kind: string, ownerEmail: string) {
  const db = getDb();
  const [job] = await db.select().from(asyncJobs).where(and(
    eq(asyncJobs.kind, kind),
    eq(asyncJobs.ownerEmail, ownerEmail),
    inArray(asyncJobs.status, ["pending", "processing"]),
  )).orderBy(desc(asyncJobs.createdAt)).limit(1);
  return job ?? null;
}

export async function markAsyncJobProcessing(id: string) {
  const db = getDb();
  await db.update(asyncJobs).set({ status: "processing", updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(asyncJobs.id, id));
}

export async function completeAsyncJob(id: string, result: unknown) {
  const db = getDb();
  await db.update(asyncJobs).set({
    status: "done",
    resultJson: JSON.stringify(result),
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(eq(asyncJobs.id, id));
}

export async function failAsyncJob(id: string, errorMessage: string) {
  const db = getDb();
  await db.update(asyncJobs).set({
    status: "failed",
    errorMessage: errorMessage.slice(0, 500),
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(eq(asyncJobs.id, id));
}

export async function getAsyncJob(id: string, ownerEmail: string) {
  const db = getDb();
  const [job] = await db.select().from(asyncJobs).where(and(
    eq(asyncJobs.id, id),
    eq(asyncJobs.ownerEmail, ownerEmail),
  )).limit(1);
  return job ?? null;
}
