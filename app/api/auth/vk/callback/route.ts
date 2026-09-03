import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { accounts } from "../../../../../db/schema";
import { resolveBaseUrl } from "../../../_lib/base-url";
import { safeReturnPath } from "../../../_lib/safe-return-path";
import { VK_TOKEN_URL, VK_USER_INFO_URL, vkOAuthConfigured, type VkUserInfo } from "../../../_lib/vk-oauth";
import { ensureAccount, getWorkspaceDb, workspaceDatabaseAvailable } from "../../../_lib/workspace-account";
import { createSiteSession } from "../../../../site-auth";

const STATE_COOKIE = "klio_vk_state";
const VERIFIER_COOKIE = "klio_vk_verifier";
const RETURN_TO_COOKIE = "klio_vk_return_to";

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);
  const jar = await cookies();
  const savedState = jar.get(STATE_COOKIE)?.value;
  const codeVerifier = jar.get(VERIFIER_COOKIE)?.value;
  const returnTo = safeReturnPath(jar.get(RETURN_TO_COOKIE)?.value);
  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);
  jar.delete(RETURN_TO_COOKIE);

  if (!vkOAuthConfigured() || !await workspaceDatabaseAvailable()) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_unavailable&provider=vk`);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // VK-issued, not something this app generates — must be echoed back
  // unchanged in the token exchange below, or VK rejects the code. See the
  // comment in api/_lib/vk-oauth.ts for where this is documented.
  const deviceId = url.searchParams.get("device_id");
  // Also covers the visitor declining on VK's consent screen (arrives back
  // with an `error` param and no `code`).
  if (!code || !state || !savedState || state !== savedState || !codeVerifier || !deviceId) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_failed&provider=vk`);
  }

  try {
    const redirectUri = new URL("/api/auth/vk/callback", baseUrl).href;
    const tokenResponse = await fetch(VK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        client_id: process.env.VK_OAUTH_CLIENT_ID!.trim(),
        device_id: deviceId,
        redirect_uri: redirectUri,
        state,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`token exchange failed: ${tokenResponse.status}`);
    const { access_token: accessToken } = await tokenResponse.json() as { access_token?: string };
    if (!accessToken) throw new Error("token exchange returned no access_token");

    const infoResponse = await fetch(VK_USER_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.VK_OAUTH_CLIENT_ID!.trim(),
        access_token: accessToken,
      }),
    });
    if (!infoResponse.ok) throw new Error(`user info fetch failed: ${infoResponse.status}`);
    const info = await infoResponse.json() as VkUserInfo;
    // VK answers a bad access_token with HTTP 200 and an `error` field, not
    // a 4xx — see the matching comment in api/auth/vk/session/route.ts.
    if (info.error) throw new Error(`user info rejected: ${info.error}`);

    const email = (info.user?.email || "").trim().toLowerCase();
    if (!email) return NextResponse.redirect(`${baseUrl}/login?error=oauth_no_email&provider=vk`);

    const displayName = [info.user?.first_name, info.user?.last_name].filter(Boolean).join(" ").trim() || email.split("@")[0];
    const account = await ensureAccount({ email, displayName, fullName: displayName });

    if (!account.emailVerified) {
      // VK has already vetted this address as belonging to the visitor who
      // just signed in — trust it outright, the same way Yandex's and the
      // ChatGPT embed's own identities are trusted, with no confirmation
      // link of our own to send.
      const db = await getWorkspaceDb();
      await db.update(accounts).set({ emailVerified: true }).where(eq(accounts.email, email));
    }

    await createSiteSession(email);
    return NextResponse.redirect(`${baseUrl}${returnTo}`);
  } catch (error) {
    console.error("VK OAuth sign-in failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_failed&provider=vk`);
  }
}
