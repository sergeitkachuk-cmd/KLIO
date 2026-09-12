import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, sessions } from "../db/schema";

export type SiteUser = { email: string; displayName: string };

const SESSION_COOKIE = "klio_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function databaseAvailable() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

// Issues a new session for `email` and sets the session cookie on the
// current response. Only the SHA-256 hash of the token is stored in the
// database — the raw token lives only in the visitor's browser.
export async function createSiteSession(email: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const db = getDb();
  await db.insert(sessions).values({
    id: hashToken(token),
    email,
    expiresAt: expiresAt.toISOString(),
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySiteSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  if (!token || !databaseAvailable()) return;
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

// Reads the session cookie and resolves it against the database. Returns
// null whenever no valid, non-expired session is found. Database errors
// propagate as availability failures rather than pretending to log out.
export async function getSiteSessionUser(): Promise<SiteUser | null> {
  // Always read request state before checking runtime configuration. Build
  // containers may have no database URL; returning before cookies() would
  // prerender and cache the anonymous redirect for authenticated visitors.
  const jar = await cookies();
  if (!databaseAvailable()) return null;
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  const db = getDb();
  const tokenHash = hashToken(token);
  const [session] = await db.select().from(sessions).where(eq(sessions.id, tokenHash)).limit(1);
  if (!session) return null;
  const expiresAt = new Date(session.expiresAt).getTime();
  // A malformed timestamp must never turn an expired session into a
  // perpetual one. Reading identity does not require a cleanup write.
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const [account] = await db.select().from(accounts).where(eq(accounts.email, session.email)).limit(1);
  if (!account) return null;
  return { email: account.email, displayName: account.displayName };
}
