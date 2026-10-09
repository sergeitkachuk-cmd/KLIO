import test from "node:test";
import assert from "node:assert/strict";
import * as orm from "drizzle-orm";
import { createDialogueHarness, load } from "./helpers/dialogue-harness.mjs";

const HOUR = 60 * 60_000;
const TRIAL = 72 * HOUR;

test("trial reminder goes once, only in the trial's final day, only to verified real addresses", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.client.close());
  const now = Date.parse("2026-10-09T12:00:00Z");
  const createdHoursAgo = (hours) => new Date(now - hours * HOUR).toISOString();
  await h.db.insert(h.schema.accounts).values([
    { email: "final-day@example.invalid", planId: "trial", emailVerified: true, generationMonth: "2026-10", createdAt: createdHoursAgo(60) },
    { email: "fresh@example.invalid", planId: "trial", emailVerified: true, generationMonth: "2026-10", createdAt: createdHoursAgo(10) },
    { email: "expired@example.invalid", planId: "trial", emailVerified: true, generationMonth: "2026-10", createdAt: createdHoursAgo(80) },
    { email: "paid@example.invalid", planId: "start", emailVerified: true, generationMonth: "2026-10", createdAt: createdHoursAgo(60) },
    { email: "unverified@example.invalid", planId: "trial", emailVerified: false, generationMonth: "2026-10", createdAt: createdHoursAgo(60) },
    { email: "79990000000", planId: "trial", emailVerified: true, generationMonth: "2026-10", createdAt: createdHoursAgo(60) },
  ]);
  const { sendTrialEndingReminders } = load("app/api/_lib/trial-reminders.ts", {
    "drizzle-orm": orm,
    "../../../db/schema": h.schema,
  });
  const sent = [];
  const run = () => sendTrialEndingReminders({ db: h.db, trialDurationMs: TRIAL, now, send: async (email) => { sent.push(email); } });

  assert.equal(await run(), 1);
  assert.deepEqual(sent, ["final-day@example.invalid"]);
  assert.equal(await run(), 0, "a second cron run never emails the same person again");
  assert.deepEqual(sent, ["final-day@example.invalid"]);
});

test("old finished jobs are removed; running jobs and recent failures are kept", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.client.close());
  const daysAgo = (days) => new Date(Date.now() - days * 24 * HOUR).toISOString();
  const job = (id, status, days) => ({ id, ownerEmail: h.owner, kind: "content_plan", status, inputJson: "{}", createdAt: daysAgo(days), updatedAt: daysAgo(days) });
  await h.db.insert(h.schema.asyncJobs).values([
    job("old-done", "done", 10),
    job("recent-done", "done", 2),
    job("old-failed", "failed", 120),
    job("recent-failed", "failed", 30),
    job("stuck-processing", "processing", 200),
  ]);
  const { cleanupOldAsyncJobs } = load("app/api/_lib/async-jobs.ts", {
    "drizzle-orm": orm,
    "../../../db": { getDb: () => h.db },
    "../../../db/schema": h.schema,
    "node:util": await import("node:util"),
    "./workspace-account": { WorkspaceAccessError: class extends Error {} },
  });
  assert.equal(await cleanupOldAsyncJobs(), 2);
  const left = (await h.db.select({ id: h.schema.asyncJobs.id }).from(h.schema.asyncJobs)).map((row) => row.id).sort();
  assert.deepEqual(left, ["recent-done", "recent-failed", "stuck-processing"]);
  assert.equal(await cleanupOldAsyncJobs(), 0, "throttled: at most once an hour");
});
