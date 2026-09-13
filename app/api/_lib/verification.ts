import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { accounts, emailVerifications } from "../../../db/schema";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Issues a new verification token for `email` and returns the raw token —
// callers put it in the emailed link. Only its hash is stored in the DB.
export async function createEmailVerification(email: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  const db = getDb();
  await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`email-verification:${email}`}, 0))`);
  await tx.delete(emailVerifications).where(eq(emailVerifications.email, email));
  await tx.insert(emailVerifications).values({
    id: hashToken(token),
    email,
    expiresAt: expiresAt.toISOString(),
  });
  });
  return token;
}

// Validates and burns a verification token (single use). On success, marks
// the matching account as verified and returns its email; otherwise null.
export async function consumeEmailVerification(token: string): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const db = getDb();
  const tokenHash = hashToken(token);
  return db.transaction(async (tx) => {
  // DELETE RETURNING gives simultaneous consumers a single winner. A failed
  // account update rolls back token consumption, allowing a safe retry.
  const [record] = await tx.delete(emailVerifications).where(eq(emailVerifications.id, tokenHash)).returning();
  if (!record) return null;

  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const [updated] = await tx.update(accounts).set({ emailVerified: true }).where(eq(accounts.email, record.email)).returning({ email: accounts.email });
  return updated?.email ?? null;
  });
}
