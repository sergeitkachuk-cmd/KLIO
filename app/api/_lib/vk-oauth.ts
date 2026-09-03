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
export type VkUserInfo = {
  user?: {
    user_id: string;
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  error?: string;
  error_description?: string;
};
