import { eq } from "drizzle-orm";
import { accounts } from "../../../../db/schema";
import { resolveBaseUrl } from "../../_lib/base-url";
import { emailDeliveryAvailable, sendVerificationEmail } from "../../_lib/email";
import { clientIp, isRateLimited } from "../../_lib/rate-limit";
import { createEmailVerification } from "../../_lib/verification";
import { getWorkspaceDb, workspaceDatabaseAvailable, workspaceErrorResponse } from "../../_lib/workspace-account";

type ResendPayload = { email?: unknown };

// Always answers the same way regardless of whether the account exists —
// avoids leaking which emails are registered.
const GENERIC_OK = { ok: true, message: "Если этот email зарегистрирован и не подтверждён, мы отправили новое письмо." } as const;

export async function POST(request: Request) {
  try {
    if (isRateLimited(`resend:${clientIp(request)}`, 5, 10 * 60 * 1000)) {
      return Response.json({ error: "Слишком много попыток. Попробуйте через несколько минут." }, { status: 429 });
    }
    if (!await workspaceDatabaseAvailable() || !emailDeliveryAvailable()) {
      return Response.json(GENERIC_OK);
    }

    const payload = await request.json() as ResendPayload;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 320) : "";
    if (!email) return Response.json(GENERIC_OK);

    const db = await getWorkspaceDb();
    const [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
    if (account?.passwordHash && !account.emailVerified) {
      const token = await createEmailVerification(email);
      const verifyUrl = `${resolveBaseUrl(request)}/api/auth/verify?token=${token}`;
      try {
        await sendVerificationEmail(email, verifyUrl);
      } catch (error) {
        console.error("Failed to resend verification email", error);
      }
    }

    return Response.json(GENERIC_OK);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
