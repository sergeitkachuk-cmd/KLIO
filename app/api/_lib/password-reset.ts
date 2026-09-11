import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../db";
import { accounts, passwordResets, sessions } from "../../../db/schema";

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
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const db = getDb();
  const tokenHash = hashToken(token);
  return db.transaction(async (tx) => {
    // DELETE RETURNING arbitrates concurrent requests; only its winner may
    // change credentials. A later failure rolls back consumption as well.
    const [record] = await tx.delete(passwordResets).where(and(
      eq(passwordResets.id, tokenHash),
      gt(passwordResets.expiresAt, new Date().toISOString()),
    )).returning();
    if (!record) return false;
    const [updated] = await tx.update(accounts).set({ passwordHash, emailVerified: true }).where(eq(accounts.email, record.email)).returning({ email: accounts.email });
    if (!updated) return false;
    await tx.delete(sessions).where(eq(sessions.email, record.email));
    await tx.delete(passwordResets).where(eq(passwordResets.email, record.email));
    return true;
  });
}
