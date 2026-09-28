// Shared config/types for "Войти через Яндекс" — see
// app/api/auth/yandex/start and .../callback. Setup: register an OAuth app
// at oauth.yandex.ru (redirect URI "<APP_BASE_URL>/api/auth/yandex/callback",
// scopes login:email + login:info + login:avatar) and set
// YANDEX_OAUTH_CLIENT_ID/YANDEX_OAUTH_CLIENT_SECRET — see .env.example for
// the exact steps.
export const YANDEX_AUTHORIZE_URL = "https://oauth.yandex.ru/authorize";
export const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
export const YANDEX_USER_INFO_URL = "https://login.yandex.ru/info";

export function yandexOAuthConfigured(): boolean {
  return Boolean(process.env.YANDEX_OAUTH_CLIENT_ID?.trim() && process.env.YANDEX_OAUTH_CLIENT_SECRET?.trim());
}

// https://yandex.ru/dev/id/doc/ru/user-information#response-format — only
// the fields the callback route actually reads are listed.
//
// default_avatar_id/is_avatar_empty only come back at all when the
// login:avatar scope was granted (see yandexAvatarUrl below) - added after
// login:email + login:info, so an account that authorized before this
// scope existed simply won't have them here until it signs in again and
// re-consents; that's fine, avatar capture is best-effort throughout.
export type YandexUserInfo = {
  id: string;
  login: string;
  default_email?: string;
  emails?: string[];
  real_name?: string;
  display_name?: string;
  default_avatar_id?: string;
  is_avatar_empty?: boolean;
};

// https://yandex.ru/dev/id/doc/ru/user-information#avatar - "islands-200"
// is Yandex's own named size (200x200, face-cropped); picked to match the
// ~40-48px account-menu circle at typical device pixel ratios without
// serving something absurdly larger than displayed.
export function yandexAvatarUrl(info: YandexUserInfo): string | null {
  if (!info.default_avatar_id || info.is_avatar_empty) return null;
  return `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-200`;
}
