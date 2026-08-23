import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { accounts, passwordResets } from "../../../db/schema";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPasswordReset(email: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const db = getDb();
  // A new request invalidates older links for the same account.
  await db.delete(passwordResets).where(eq(passwordResets.email, email));
  await db.insert(passwordResets).values({
    id: hashToken(token),
    email,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString(),
  });
  return token;
}

export async function consumePasswordReset(token: string, passwordHash: string): Promise<boolean> {
  const db = getDb();
  const tokenHash = hashToken(token);
  const [record] = await db.select().from(passwordResets).where(eq(passwordResets.id, tokenHash)).limit(1);
  if (!record) return false;

  // Burn the token before changing the password: it is single-use even if a
  // client retries the request after the update has already succeeded.
  await db.delete(passwordResets).where(eq(passwordResets.id, tokenHash));
  if (new Date(record.expiresAt).getTime() < Date.now()) return false;

  const [updated] = await db.update(accounts).set({ passwordHash, emailVerified: true }).where(eq(accounts.email, record.email)).returning({ email: accounts.email });
  if (!updated) return false;
  await db.delete(passwordResets).where(eq(passwordResets.email, record.email));
  return true;
}
