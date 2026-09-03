// Shared config/types for "Войти через Яндекс" — see
// app/api/auth/yandex/start and .../callback. Setup: register an OAuth app
// at oauth.yandex.ru (redirect URI "<APP_BASE_URL>/api/auth/yandex/callback",
// scopes login:email + login:info) and set YANDEX_OAUTH_CLIENT_ID/
// YANDEX_OAUTH_CLIENT_SECRET — see .env.example for the exact steps.
export const YANDEX_AUTHORIZE_URL = "https://oauth.yandex.ru/authorize";
export const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
export const YANDEX_USER_INFO_URL = "https://login.yandex.ru/info";

export function yandexOAuthConfigured(): boolean {
  return Boolean(process.env.YANDEX_OAUTH_CLIENT_ID?.trim() && process.env.YANDEX_OAUTH_CLIENT_SECRET?.trim());
}

// https://yandex.ru/dev/id/doc/ru/user-information#response-format — only
// the fields the callback route actually reads are listed.
export type YandexUserInfo = {
  id: string;
  login: string;
  default_email?: string;
  emails?: string[];
  real_name?: string;
  display_name?: string;
};
