import { createHash, randomBytes } from "node:crypto";

// Shared config/types/PKCE helpers for "Войти через VK" — see
// app/api/auth/vk/start and .../callback.
//
// VK ID (id.vk.com, VK's OAuth 2.1 system since ~2023 — NOT the older
// oauth.vk.com classic flow, which is a different, simpler protocol) is
// meaningfully different from Yandex's OAuth: it mandates PKCE, and its
// callback carries a VK-issued `device_id` alongside `code`/`state` that
// must be echoed back unchanged during the token exchange, or VK rejects
// the code. There is no equivalent in Yandex's flow.
//
// Endpoints, params and the PKCE shape below are reconstructed from VK's
// own working integrations (the vk.provider.ts in gitroomhq/postiz-app, and
// the omniauth-vk_id Ruby strategy) rather than a fetchable VK doc page
// (id.vk.com blocks this environment's fetcher outright) — treat this as a
// best-effort implementation to verify against a real app, the same way
// Yandex's scope string needed a live round of debugging before it matched
// what was actually registered.
//
// Setup: register an app at https://id.vk.com/business (VK ID for
// business) or https://vk.com/apps?act=manage, platform "Веб-сайт", with
// redirect URI "<APP_BASE_URL>/api/auth/vk/callback", and set
// VK_OAUTH_CLIENT_ID — see .env.example.
export const VK_AUTHORIZE_URL = "https://id.vk.com/authorize";
export const VK_TOKEN_URL = "https://id.vk.com/oauth2/auth";
export const VK_USER_INFO_URL = "https://id.vk.com/oauth2/user_info";

// api/auth/vk/publish/* (not sign-in) requests these three specifically for
// photos.getWallUploadServer/photos.saveWallPhoto — see the long comment on
// VkCredentials.photoAccessToken in publishing-config.ts for why only those
// two methods need a user token at all. "offline" is what VK support itself
// pointed the site owner at (their own reply: since 2024-06-25 every user
// token is 1h regardless of scope, but offline is still what makes VK
// issue a refresh_token at all, per their reply's own "его можно обновлять
// с помощью Refresh Token, его срок действия — 180 дней").
export const VK_PUBLISH_SCOPE = "wall photos groups offline";

export function vkOAuthConfigured(): boolean {
  return Boolean(process.env.VK_OAUTH_CLIENT_ID?.trim());
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// RFC 7636 PKCE, S256 method — this half is a public, provider-agnostic
// standard (unlike the VK-specific pieces above) and the same for any OAuth
// 2.1 provider requiring PKCE.
export function generatePkceVerifier(): string {
  return base64UrlEncode(randomBytes(64));
}

export function pkceChallengeFromVerifier(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

// https://id.vk.com/oauth2/user_info's response shape — the `user` fields
// match @vkid/sdk's own UserInfoResult/UserData types verbatim (checked
// against the package's shipped .d.ts, unlike the rest of this file), and
// `error`/`error_description` were confirmed live: VK answers an invalid
// access_token with HTTP 200 and this shape instead of a 4xx, so callers
// MUST check `error` before assuming a missing `user.email` means "this
// VK account just has no email" rather than "the token itself was bad".
// avatar (added later than the rest of this type - confirmed against the
// same shipped .d.ts, dist-sdk/types/auth/types.d.ts's UserData) is only
// actually populated when the app's "Фото профиля" registration-data
// toggle is on (VK ID app dashboard → Авторизация → Данные для
// регистрации - site owner confirmed this is already enabled for this
// app). A URL straight from VK's own CDN, safe to use as-is.
export type VkUserInfo = {
  user?: {
    user_id: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    avatar?: string;
  };
  error?: string;
  error_description?: string;
};

export type VkTokenExchange = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

// Same reconstructed-not-fetched caveat as the rest of this file (see the
// top comment): a refresh grant's exact parameter set for VK ID specifically
// is not independently confirmed against a live app the way the initial
// authorization_code exchange in api/auth/vk/callback already is. Sending
// device_id is a deliberate choice, not confirmed necessary - VK ID ties
// the *original* code exchange to the device_id from its own redirect (see
// the callback route), and refresh grants on device-bound OAuth systems
// generally expect the same device_id back; omitting a param VK doesn't
// need is usually harmless, while omitting one it does need fails outright,
// so this errs on sending it. If this call starts failing in production
// logs, that mismatch - not the token itself - is the first thing to check.
export async function refreshVkAccessToken(refreshToken: string, deviceId: string): Promise<VkTokenExchange> {
  const response = await fetch(VK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.VK_OAUTH_CLIENT_ID!.trim(),
      device_id: deviceId,
      scope: VK_PUBLISH_SCOPE,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;
  if (!response.ok || !payload || payload.error || !payload.access_token || !payload.refresh_token) {
    throw new Error(payload?.error_description || payload?.error || `refresh failed: ${response.status}`);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    // VK support's own reply: access tokens are 1h regardless of scope.
    // expires_in is still read from the response rather than hardcoded, in
    // case that ever changes.
    expiresInSeconds: typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 3600,
  };
}
