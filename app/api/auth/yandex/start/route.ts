import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveBaseUrl } from "../../../_lib/base-url";
import { safeReturnPath } from "../../../_lib/safe-return-path";
import { YANDEX_AUTHORIZE_URL, yandexOAuthConfigured } from "../../../_lib/yandex-oauth";

const STATE_COOKIE = "klio_yandex_state";
const RETURN_TO_COOKIE = "klio_yandex_return_to";
// Just long enough to cover the redirect round trip through Yandex's own
// consent screen — not a session, so it doesn't need the 30-day TTL
// site-auth.ts's real session cookie gets.
const COOKIE_TTL_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);

  if (!yandexOAuthConfigured()) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_unavailable`);
  }

  const url = new URL(request.url);
  const returnTo = safeReturnPath(url.searchParams.get("return_to"));
  // CSRF guard for the callback: only a request carrying this exact value
  // back (from a cookie only this response sets) is accepted as a real
  // continuation of this specific sign-in attempt.
  const state = randomBytes(24).toString("hex");

  // Built via the URL constructor rather than plain string concatenation so
  // a Cyrillic APP_BASE_URL (KLIO's own domain is an IDN, цифроваяредакция.рф)
  // comes out as its ASCII/punycode form — Yandex compares this byte-for-byte
  // against the Redirect URI registered in the OAuth app, and that field
  // must be registered in the same punycode form for the two to match.
  const redirectUri = new URL("/api/auth/yandex/callback", baseUrl).href;

  const authorizeUrl = new URL(YANDEX_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", process.env.YANDEX_OAUTH_CLIENT_ID!.trim());
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "login:email login:info");
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl.toString());
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_TTL_SECONDS,
  };
  response.cookies.set(STATE_COOKIE, state, cookieOptions);
  response.cookies.set(RETURN_TO_COOKIE, returnTo, cookieOptions);
  return response;
}
