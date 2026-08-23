import { eq } from "drizzle-orm";
import { resolveBaseUrl } from "../../_lib/base-url";
import { emailDeliveryAvailable, sendPasswordResetEmail } from "../../_lib/email";
import { isRateLimited, clientIp } from "../../_lib/rate-limit";
import { createPasswordReset } from "../../_lib/password-reset";
import { workspaceDatabaseAvailable } from "../../_lib/workspace-account";
import { getDb } from "../../../../db";
import { accounts } from "../../../../db/schema";

const GENERIC_OK = { ok: true, message: "Если аккаунт существует, мы отправили письмо со ссылкой для смены пароля." } as const;

export async function POST(request: Request) {
  if (isRateLimited(`forgot-password:${clientIp(request)}`, 5, 15 * 60 * 1000)) return Response.json(GENERIC_OK);
  const payload = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase().slice(0, 320) : "";
  if (!email || !await workspaceDatabaseAvailable() || !emailDeliveryAvailable()) return Response.json(GENERIC_OK);

  try {
    const db = getDb();
    const [account] = await db.select({ email: accounts.email, passwordHash: accounts.passwordHash }).from(accounts).where(eq(accounts.email, email)).limit(1);
    if (account?.passwordHash) {
      const token = await createPasswordReset(email);
      const resetUrl = `${resolveBaseUrl(request)}/reset-password?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail(email, resetUrl);
    }
  } catch (error) {
    console.error("Password reset request failed", error instanceof Error ? error.message : "unknown error");
  }
  return Response.json(GENERIC_OK);
}
