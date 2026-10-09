import { and, eq, isNull, like, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { accounts } from "../../../db/schema";

const TRIAL_REMINDER_BATCH_SIZE = 20;
const TRIAL_REMINDER_LEAD_MS = 24 * 60 * 60_000;

// One "trial ends soon" email per account, during the trial's final day.
// Only verified, real addresses (VK sign-ins without an email are stored
// under a phone number). Each account is claimed before sending, so
// overlapping cron runs can never email anyone twice; a failed send is
// logged, not repeated.
export async function sendTrialEndingReminders({ db, trialDurationMs, send, now = Date.now() }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- works with both the app's and the test's Postgres driver
  db: PgDatabase<PgQueryResultHKT, any>;
  trialDurationMs: number;
  send: (email: string) => Promise<void>;
  now?: number;
}): Promise<number> {
  const endsAfter = new Date(now - trialDurationMs).toISOString();
  const endsWithinLead = new Date(now - trialDurationMs + TRIAL_REMINDER_LEAD_MS).toISOString();
  const candidates = await db.select({ email: accounts.email }).from(accounts).where(and(
    eq(accounts.planId, "trial"),
    eq(accounts.emailVerified, true),
    isNull(accounts.trialReminderSentAt),
    like(accounts.email, "%@%"),
    sql`${accounts.createdAt}::timestamptz > ${endsAfter}::timestamptz`,
    sql`${accounts.createdAt}::timestamptz <= ${endsWithinLead}::timestamptz`,
  )).limit(TRIAL_REMINDER_BATCH_SIZE);
  let sent = 0;
  for (const { email } of candidates) {
    const [claimed] = await db.update(accounts).set({ trialReminderSentAt: new Date(now).toISOString() }).where(and(
      eq(accounts.email, email), eq(accounts.planId, "trial"), isNull(accounts.trialReminderSentAt),
    )).returning({ email: accounts.email });
    if (!claimed) continue;
    try {
      await send(email);
      sent += 1;
    } catch (error) {
      console.error("trial reminder email failed", error instanceof Error ? error.message : "unknown error");
    }
  }
  return sent;
}
