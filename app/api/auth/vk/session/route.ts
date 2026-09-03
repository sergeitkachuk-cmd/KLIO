import { eq } from "drizzle-orm";
import { accounts } from "../../../../../db/schema";
import { safeReturnPath } from "../../../_lib/safe-return-path";
import { VK_USER_INFO_URL, vkOAuthConfigured, type VkUserInfo } from "../../../_lib/vk-oauth";
import { clientIp, isRateLimited } from "../../../_lib/rate-limit";
import { createSiteSession } from "../../../../site-auth";
import { ensureAccount, getWorkspaceDb, workspaceDatabaseAvailable, workspaceErrorResponse } from "../../../_lib/workspace-account";

type SessionPayload = { accessToken?: unknown; returnTo?: unknown };

// Counterpart to the widget in app/vk-onetap.tsx. VK ID's OneTap runs the
// whole code→token exchange in the browser via VKID.Auth.exchangeCode (VK's
// SDK, not this server) — this route is what turns the resulting
// access_token into an actual KLIO session. It never trusts client-supplied
// email/name: it re-fetches them itself from VK using the token, the same
// way api/auth/vk/callback (the plain-link fallback flow) already does.
export async function POST(request: Request) {
  try {
    if (isRateLimited(`vk-onetap:${clientIp(request)}`, 20, 10 * 60 * 1000)) {
      return Response.json({ error: "Слишком много попыток входа. Попробуйте через несколько минут." }, { status: 429 });
    }
    if (!vkOAuthConfigured() || !await workspaceDatabaseAvailable()) {
      return Response.json({ error: "Вход через VK временно недоступен." }, { status: 503 });
    }

    const payload = await request.json().catch(() => null) as SessionPayload | null;
    const accessToken = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
    const returnTo = safeReturnPath(typeof payload?.returnTo === "string" ? payload.returnTo : null);
    if (!accessToken) return Response.json({ error: "Не удалось войти через VK." }, { status: 400 });

    const infoResponse = await fetch(VK_USER_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.VK_OAUTH_CLIENT_ID!.trim(),
        access_token: accessToken,
      }),
    });
    if (!infoResponse.ok) {
      console.error("VK OneTap user_info fetch failed", infoResponse.status);
      return Response.json({ error: "Не удалось войти через VK. Попробуйте ещё раз." }, { status: 502 });
    }
    const info = await infoResponse.json() as VkUserInfo;
    // VK answers a bad/expired access_token with HTTP 200 and an `error`
    // field, not a 4xx — confirmed live against id.vk.com. Must be checked
    // before falling through to "no email", or a stale token reads as "add
    // an email to your VK account" instead of the real problem.
    if (info.error) {
      console.error("VK OneTap user_info rejected", info.error, info.error_description);
      return Response.json({ error: "Не удалось войти через VK. Попробуйте ещё раз." }, { status: 502 });
    }

    const email = (info.user?.email || "").trim().toLowerCase();
    if (!email) {
      return Response.json({ error: "В вашем аккаунте VK не указан email — добавьте его в настройках или войдите по email и паролю." }, { status: 422 });
    }

    const displayName = [info.user?.first_name, info.user?.last_name].filter(Boolean).join(" ").trim() || email.split("@")[0];
    const account = await ensureAccount({ email, displayName, fullName: displayName });

    if (!account.emailVerified) {
      // VK has already vetted this address — trust it outright, same as
      // the plain-link VK flow and Yandex's.
      const db = await getWorkspaceDb();
      await db.update(accounts).set({ emailVerified: true }).where(eq(accounts.email, email));
    }

    await createSiteSession(email);
    return Response.json({ ok: true, returnTo });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
