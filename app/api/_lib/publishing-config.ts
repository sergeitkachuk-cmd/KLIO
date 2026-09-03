// Single source of truth for KLIO's "Публикации" module: which platforms
// exist, what shape their credentials take, what limits their API actually
// enforces, and the retry policy every publish attempt follows. Nothing
// outside this file should hardcode a platform id, a text-length limit, or
// a retry count — see social-publish.ts for the call site that reads this
// config, social-channels.ts for connecting a channel, and
// app/api/publications/route.ts plus app/api/cron/publish-due/route.ts for
// where publishing actually happens.

export type SocialPlatform = "telegram" | "vk";

export const SOCIAL_PLATFORMS: Array<{ id: SocialPlatform; label: string }> = [
  { id: "telegram", label: "Telegram" },
  { id: "vk", label: "VK" },
];

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return value === "telegram" || value === "vk";
}

export type PublicationStatus = "scheduled" | "publishing" | "published" | "failed";

// Credential shapes per platform — see social-channels.ts's connect flow for
// how each is validated against the real API before a channel row is ever
// written, and the design discussion this module came out of for why VK
// specifically only works with a manually-issued community token today:
// VK ID (id.vk.com — the same flow app/api/_lib/vk-oauth.ts uses for sign-in)
// issues vk2.a.* tokens that the classic API rejects for wall.post
// ("Method is not available for this profile type"), and oauth.vk.com — the
// classic flow that would grant a scoped user token for groups.get/wall.post
// — returns 401 to newly registered apps. A community's own service token
// (group admin panel → "Работа с API" → "Ключи доступа") is the one path
// confirmed still working, so that's what connectChannel expects. Revisit if
// VK's platform policy here ever changes.
export type TelegramCredentials = {
  botToken: string;
  // Channel/group id or @username the bot must already be an admin of.
  chatId: string;
};

export type VkCredentials = {
  // Positive community id (the group's own id, not the negative owner_id
  // wall.post itself expects — social-publish.ts negates it at the call
  // site so every other piece of code can work with the plain, positive id
  // VK's own UI shows).
  groupId: string;
  // Community service token used for the final wall.post call.
  accessToken: string;
  // VK rejects wall-photo uploads made with a community token (error 27).
  // A user token with wall+photos scope is required only when a post has an image.
  photoAccessToken?: string;
};

export type ChannelCredentials =
  | { platform: "telegram"; telegram: TelegramCredentials }
  | { platform: "vk"; vk: VkCredentials };

// VK's API is versioned by every request; bump deliberately, not silently.
export const VK_API_VERSION = "5.199";

// Real per-platform ceilings, not arbitrary round numbers:
// - Telegram: sendMessage's text limit is 4096 chars; sendPhoto's caption
//   limit is a separate, much smaller 1024.
// - VK: wall.post's message limit — kept conservative pending live
//   verification (VK's own number has moved before and isn't reliably
//   documented; better to truncate a little early than have a real post
//   rejected outright for length).
export const PLATFORM_TEXT_LIMITS: Record<SocialPlatform, { textOnly: number; withImage: number }> = {
  telegram: { textOnly: 4096, withImage: 1024 },
  vk: { textOnly: 15000, withImage: 15000 },
};

export function truncateForPlatform(platform: SocialPlatform, text: string, hasImage: boolean): string {
  const limit = hasImage ? PLATFORM_TEXT_LIMITS[platform].withImage : PLATFORM_TEXT_LIMITS[platform].textOnly;
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

// A failed publish attempt retries on the cron's own next pass (roughly a
// minute later — see publish-due/route.ts), not in a tight in-request loop
// like ai-router's transient retries: a platform rate limit or a momentary
// 5xx is exactly the kind of thing that clears up given real wall-clock
// time, not milliseconds. After this many attempts the row is marked
// "failed" for good and the owner is emailed (see sendPublicationFailedEmail
// in _lib/email.ts) instead of retrying forever.
export const MAX_PUBLISH_RETRIES = 3;
