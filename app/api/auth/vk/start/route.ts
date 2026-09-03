import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveBaseUrl } from "../../../_lib/base-url";
import { safeReturnPath } from "../../../_lib/safe-return-path";
import { VK_AUTHORIZE_URL, generatePkceVerifier, pkceChallengeFromVerifier, vkOAuthConfigured } from "../../../_lib/vk-oauth";

const STATE_COOKIE = "klio_vk_state";
const VERIFIER_COOKIE = "klio_vk_verifier";
const RETURN_TO_COOKIE = "klio_vk_return_to";
// Just long enough to cover the redirect round trip through VK's own
// consent screen — not a session, so it doesn't need the 30-day TTL
// site-auth.ts's real session cookie gets.
const COOKIE_TTL_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);

  if (!vkOAuthConfigured()) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_unavailable&provider=vk`);
  }

  const url = new URL(request.url);
  const returnTo = safeReturnPath(url.searchParams.get("return_to"));
  // CSRF guard for the callback, same role as Yandex's start route.
  const state = randomBytes(24).toString("hex");
  // PKCE (VK ID mandates this, Yandex's flow doesn't use it): the verifier
  // stays server-side in a cookie for the whole round trip; only its SHA-256
  // hash (the challenge) goes to VK now, and the raw verifier is sent once,
  // at the token exchange in the callback, so VK can confirm this exact
  // browser session is the one that started the flow.
  const codeVerifier = generatePkceVerifier();
  const codeChallenge = pkceChallengeFromVerifier(codeVerifier);

  // Built via the URL constructor, not string concatenation, so a Cyrillic
  // APP_BASE_URL (цифроваяредакция.рф) comes out as punycode — see the
  // matching comment in api/auth/yandex/start/route.ts.
  const redirectUri = new URL("/api/auth/vk/callback", baseUrl).href;

  const authorizeUrl = new URL(VK_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", process.env.VK_OAUTH_CLIENT_ID!.trim());
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "email vkid.personal_info");
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
  response.cookies.set(VERIFIER_COOKIE, codeVerifier, cookieOptions);
  response.cookies.set(RETURN_TO_COOKIE, returnTo, cookieOptions);
  return response;
}
