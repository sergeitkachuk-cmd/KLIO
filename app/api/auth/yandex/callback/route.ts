import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { accounts } from "../../../../../db/schema";
import { resolveBaseUrl } from "../../../_lib/base-url";
import { safeReturnPath } from "../../../_lib/safe-return-path";
import { YANDEX_TOKEN_URL, YANDEX_USER_INFO_URL, yandexOAuthConfigured, type YandexUserInfo } from "../../../_lib/yandex-oauth";
import { ensureAccount, getWorkspaceDb, workspaceDatabaseAvailable } from "../../../_lib/workspace-account";
import { createSiteSession } from "../../../../site-auth";

const STATE_COOKIE = "klio_yandex_state";
const RETURN_TO_COOKIE = "klio_yandex_return_to";

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);
  const jar = await cookies();
  const savedState = jar.get(STATE_COOKIE)?.value;
  const returnTo = safeReturnPath(jar.get(RETURN_TO_COOKIE)?.value);
  jar.delete(STATE_COOKIE);
  jar.delete(RETURN_TO_COOKIE);

  if (!yandexOAuthConfigured() || !await workspaceDatabaseAvailable()) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_unavailable`);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // Also covers the visitor clicking "Отменить" on Yandex's consent screen
  // (arrives back with an `error` param and no `code`).
  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_failed`);
  }

  try {
    const tokenResponse = await fetch(YANDEX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: process.env.YANDEX_OAUTH_CLIENT_ID!.trim(),
        client_secret: process.env.YANDEX_OAUTH_CLIENT_SECRET!.trim(),
      }),
    });
    if (!tokenResponse.ok) throw new Error(`token exchange failed: ${tokenResponse.status}`);
    const { access_token: accessToken } = await tokenResponse.json() as { access_token?: string };
    if (!accessToken) throw new Error("token exchange returned no access_token");

    const infoResponse = await fetch(`${YANDEX_USER_INFO_URL}?format=json`, {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    if (!infoResponse.ok) throw new Error(`user info fetch failed: ${infoResponse.status}`);
    const info = await infoResponse.json() as YandexUserInfo;

    const email = (info.default_email || info.emails?.[0] || "").trim().toLowerCase();
    if (!email) return NextResponse.redirect(`${baseUrl}/login?error=oauth_no_email`);

    const displayName = info.real_name || info.display_name || info.login || email.split("@")[0];
    const account = await ensureAccount({ email, displayName, fullName: displayName });

    if (!account.emailVerified) {
      // Yandex has already vetted this address as belonging to the visitor
      // who just signed in — trust it outright, the same way the ChatGPT
      // embed's header-based identity is trusted, with no confirmation
      // link of our own to send.
      const db = await getWorkspaceDb();
      await db.update(accounts).set({ emailVerified: true }).where(eq(accounts.email, email));
    }

    await createSiteSession(email);
    return NextResponse.redirect(`${baseUrl}${returnTo}`);
  } catch (error) {
    console.error("Yandex OAuth sign-in failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_failed`);
  }
}
