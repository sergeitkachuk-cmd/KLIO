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

type AsyncJobClaim = { id: string; reused: boolean };

// Claiming a job must be one database operation. A separate "find active"
// followed by INSERT has a race: a browser retry, two tabs, or a proxy replay
// can make both requests observe no job and both start a billable AI call.
// PostgreSQL advisory locks are transaction-scoped, need no persistent schema
// change, and serialize only the same owner's same job kind.
export async function claimAsyncJob(kind: string, ownerEmail: string, input: unknown, maxAgeMs?: number): Promise<AsyncJobClaim> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const lockKey = `klio:async-job:${kind}:${ownerEmail.toLowerCase()}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const [active] = await tx.select().from(asyncJobs).where(and(
      eq(asyncJobs.kind, kind),
      eq(asyncJobs.ownerEmail, ownerEmail),
      inArray(asyncJobs.status, ["pending", "processing"]),
    )).orderBy(desc(asyncJobs.createdAt)).limit(1);

    if (active) {
      const updatedAt = Date.parse(active.updatedAt);
      if (!maxAgeMs || !Number.isFinite(updatedAt) || Date.now() - updatedAt <= maxAgeMs) {
        return { id: active.id, reused: true };
      }
      await tx.update(asyncJobs).set({
        status: "failed",
        errorMessage: "Сборка контент‑плана превысила лимит времени. Запустите её ещё раз.",
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(asyncJobs.id, active.id));
    }

    const id = crypto.randomUUID();
    await tx.insert(asyncJobs).values({
      id,
      ownerEmail,
      kind,
      status: "pending",
      inputJson: JSON.stringify(input),
    });
    return { id, reused: false };
  });
}

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
export async function findActiveAsyncJob(kind: string, ownerEmail: string, maxAgeMs?: number) {
  const db = getDb();
  const [job] = await db.select().from(asyncJobs).where(and(
    eq(asyncJobs.kind, kind),
    eq(asyncJobs.ownerEmail, ownerEmail),
    inArray(asyncJobs.status, ["pending", "processing"]),
  )).orderBy(desc(asyncJobs.createdAt)).limit(1);
  if (!job) return null;
  const updatedAt = Date.parse(job.updatedAt);
  if (maxAgeMs && Number.isFinite(updatedAt) && Date.now() - updatedAt > maxAgeMs) {
    await failAsyncJob(job.id, "Сборка контент‑плана превысила лимит времени. Запустите её ещё раз.");
    return null;
  }
  return job;
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
  // A job that the status endpoint has expired must stay failed even if an
  // old provider request finally returns after its deadline.
  }).where(and(eq(asyncJobs.id, id), eq(asyncJobs.status, "processing")));
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

// A freshly regenerated plan replaces the browser's previous draft, so the
// client alone cannot reliably remember titles from earlier unsaved versions.
// Keep a compact server-side exclusion list from recently completed jobs.
export async function recentCompletedContentPlanTitles(ownerEmail: string, limit = 24) {
  const db = getDb();
  const jobs = await db.select({ resultJson: asyncJobs.resultJson }).from(asyncJobs).where(and(
    eq(asyncJobs.ownerEmail, ownerEmail),
    eq(asyncJobs.kind, "content_plan"),
    eq(asyncJobs.status, "done"),
  )).orderBy(desc(asyncJobs.createdAt)).limit(8);
  const titles: string[] = [];
  for (const job of jobs) {
    try {
      const parsed = JSON.parse(job.resultJson || "{}") as { result?: { items?: Array<{ title?: unknown }> } };
      for (const item of parsed.result?.items || []) {
        if (typeof item.title === "string" && item.title.trim()) titles.push(item.title.trim());
        if (titles.length >= limit) return [...new Set(titles)];
      }
    } catch {
      // A malformed historical result must never block a new plan.
    }
  }
  return [...new Set(titles)].slice(0, limit);
}
