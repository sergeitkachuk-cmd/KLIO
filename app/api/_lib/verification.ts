import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
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
  await db.insert(emailVerifications).values({
    id: hashToken(token),
    email,
    expiresAt: expiresAt.toISOString(),
  });
  return token;
}

// Validates and burns a verification token (single use). On success, marks
// the matching account as verified and returns its email; otherwise null.
export async function consumeEmailVerification(token: string): Promise<string | null> {
  const db = getDb();
  const tokenHash = hashToken(token);
  const [record] = await db.select().from(emailVerifications).where(eq(emailVerifications.id, tokenHash)).limit(1);
  if (!record) return null;

  await db.delete(emailVerifications).where(eq(emailVerifications.id, tokenHash));
  if (new Date(record.expiresAt).getTime() < Date.now()) return null;

  await db.update(accounts).set({ emailVerified: true }).where(eq(accounts.email, record.email));
  return record.email;
}
