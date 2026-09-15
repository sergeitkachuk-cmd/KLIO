// Validates a VK/Telegram connection against the real platform before it is
// ever written to the socialChannels table — a channel row only exists here
// once we have proof the credentials actually work, never from a bare
// unchecked paste. Also the one place that decides what's safe to hand back
// to the browser (socialChannelSummary strips credentialsJson unconditionally
// — see the comment on that column in db/schema.ts).

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { VK_API_VERSION, type ChannelCredentials } from "./publishing-config";
import { socialChannels } from "../../../db/schema";
import { telegramApiBase } from "./telegram-proxy";

export class ChannelValidationError extends Error {}

const telegramLinkPrefixCache = new Map<string, { prefix: string | null; expiresAt: number }>();
const telegramLinkPrefixPending = new Map<string, Promise<string | null>>();

// Same Timeweb IPv6-routing risk already fixed for the actual publish call
// (postToTelegramApi in social-publish.ts) - getChat talks to the exact
// same api.telegram.org host over plain fetch() and hit the same
// connect-timeout signature (site owner: connecting a new Telegram channel
// failed the same day, right after the publish path had already been
// pinned) - it just went unnoticed until now because connecting a channel
// happens far less often than publishing to one already connected.
function telegramPostPinnedIPv4(url: string, body: string, signal: AbortSignal): Promise<{ status: number; json: () => Promise<unknown> }> {
  const endpoint = new URL(url);
  // Plain HTTP when talking to a self-hosted Bot API server (see
  // telegramApiBase) instead of the real, always-HTTPS api.telegram.org.
  const requestFn = endpoint.protocol === "http:" ? httpRequest : httpsRequest;
  return new Promise((resolve, reject) => {
    const request = requestFn({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || (endpoint.protocol === "http:" ? 80 : 443),
      path: `${endpoint.pathname}${endpoint.search}`,
      method: "POST",
      family: 4,
      signal,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { response.destroy(new Error("Telegram response is too large.")); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status, json: async () => JSON.parse(text) });
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(body);
  });
}

// getChat does not change anything in Telegram, so one short retry is safe:
// it smooths over a transient DNS/TLS failure without risking duplicate posts.
async function telegramGetChat(botToken: string, chatId: string): Promise<{ status: number; json: () => Promise<unknown> }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await telegramPostPinnedIPv4(
        `${telegramApiBase()}/bot${botToken}/getChat`,
        JSON.stringify({ chat_id: chatId }),
        AbortSignal.timeout(15_000),
      );
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  const cause = lastError instanceof Error ? lastError.cause : undefined;
  console.error("Telegram getChat request failed", {
    message: lastError instanceof Error ? lastError.message : String(lastError),
    cause: cause instanceof Error ? cause.message : undefined,
  });
  throw lastError;
}

async function describeTelegramChannel(telegram: { botToken: string; chatId: string }): Promise<{ label: string; avatarUrl: string }> {
  if (!telegram.botToken.trim() || !telegram.chatId.trim()) {
    throw new ChannelValidationError("Укажите токен бота и id канала.");
  }
  try {
    const response = await telegramGetChat(telegram.botToken, telegram.chatId);
    const payload = await response.json().catch(() => null) as
      | { ok: boolean; result?: { title?: string; username?: string; type?: string }; description?: string }
      | null;
    if (response.status >= 500 || response.status === 429 || !payload) {
      throw new ChannelValidationError("Telegram временно недоступен или вернул некорректный ответ. Попробуйте подключить канал позже. Это не подтверждает ошибку токена.");
    }
    if (!payload?.ok || !payload.result) {
      throw new ChannelValidationError(
        payload?.description
          ? `Telegram отклонил подключение: ${payload.description}`
          : "Telegram отклонил подключение — проверьте токен бота и id канала.",
      );
    }
    // Confirms the bot even knows about this chat, but not yet that it can
    // post there — getChatMember(bot's own id) would need one more call and
    // its own id, which getMe would supply; left as a fast-follow rather than
    // three calls for a connect step that already fails loudly the first time
    // someone actually tries to publish with insufficient rights.
    const label = payload.result.title || payload.result.username || telegram.chatId;
    // No avatar for Telegram in this first pass — getChat only returns a
    // small_file_id, which itself needs a getFile follow-up call to resolve
    // to a fetchable URL. Channel cards fall back to a plain platform icon.
    return { label, avatarUrl: "" };
  } catch (error) {
    if (error instanceof ChannelValidationError) throw error;
    throw new ChannelValidationError("Не удалось установить связь с Telegram. Попробуйте позже. Проверить токен сейчас не удалось — менять его из-за этой ошибки не нужно.");
  }
}

async function describeVkChannel(vk: { groupId: string; accessToken: string }): Promise<{ label: string; avatarUrl: string; resolvedGroupId: string }> {
  if (!vk.groupId.trim() || !vk.accessToken.trim()) {
    throw new ChannelValidationError("Укажите id сообщества и токен доступа.");
  }
  // groups.getById accepts a screen name/vanity URL (vk.com/kliopress) just
  // as well as the raw numeric id — and a "красивое" screen name is VK's
  // own product feature, not an edge case, so requiring the numeric id up
  // front (an earlier version of this function did exactly that) locked
  // out most real communities. wall.post further down the pipeline still
  // needs a real integer to negate into owner_id (see vkGroupIdNumber in
  // social-publish.ts), so instead of asking the person to go dig it out
  // of "Работа с API" themselves, resolve it here from VK's own answer —
  // group.id in the groups.getById response is always the numeric id,
  // regardless of which form was typed in — and save that instead of
  // whatever was typed. The typed value (name or number) still round-trips
  // through this same call as validation that it's real and reachable.
  let response: Response;
  try {
    response = await fetch("https://api.vk.com/method/groups.getById", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        group_id: vk.groupId,
        access_token: vk.accessToken,
        fields: "photo_200",
        v: VK_API_VERSION,
      }),
    });
  } catch {
    throw new ChannelValidationError("Не удалось связаться с VK. Проверьте токен доступа.");
  }
  const payload = await response.json().catch(() => null) as
    | { response?: unknown; error?: { error_msg: string } }
    | null;
  if (!payload || payload.error) {
    throw new ChannelValidationError(
      payload?.error ? `VK отклонил подключение: ${payload.error.error_msg}` : "VK отклонил подключение — проверьте id сообщества и токен.",
    );
  }
  // API version has moved between a bare array and a { groups: [...] }
  // wrapper across VK's history — accept either rather than assume.
  const raw = payload.response;
  const groups = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? (raw as { groups?: unknown[] }).groups : undefined);
  const group = Array.isArray(groups) ? groups[0] as Record<string, unknown> : undefined;
  if (!group || typeof group.name !== "string") throw new ChannelValidationError("VK не нашёл сообщество с этим id.");
  if (typeof group.id !== "number" || !Number.isInteger(group.id) || group.id <= 0) {
    throw new ChannelValidationError("VK не вернул числовой id сообщества — попробуйте другой способ его указать.");
  }
  return { label: group.name, avatarUrl: typeof group.photo_200 === "string" ? group.photo_200 : "", resolvedGroupId: String(group.id) };
}

// Throws ChannelValidationError (safe to show verbatim to the user) on
// anything wrong with the credentials themselves; anything else (network,
// malformed platform response) is wrapped into the same error type so the
// connect route has exactly one error shape to handle.
//
// resolvedGroupId (VK only) is the numeric id VK itself returned for
// whatever was typed (screen name or number) — the connect route should
// save this instead of the raw input so every later publish always works
// with a guaranteed-numeric id. Absent for Telegram, which has no
// equivalent name/id duality.
export async function describeChannel(credentials: ChannelCredentials): Promise<{ label: string; avatarUrl: string; resolvedGroupId?: string }> {
  if (credentials.platform === "telegram") return describeTelegramChannel(credentials.telegram);
  return describeVkChannel(credentials.vk);
}

export function socialChannelSummary(row: typeof socialChannels.$inferSelect) {
  return {
    id: row.id,
    brandId: row.brandId,
    platform: row.platform,
    label: row.label,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
  };
}

// A publication stores Telegram's message_id after a successful send.  Turn
// it into a safe, credential-free link for the owner so "published" can be
// verified in Telegram itself, not inferred from a calendar tick.
export async function telegramPublicationUrl(row: typeof socialChannels.$inferSelect | undefined, providerPostId: string | null) {
  if (!row || row.platform !== "telegram" || !providerPostId || !/^\d+$/.test(providerPostId)) return null;
  try {
    const credentials = JSON.parse(row.credentialsJson) as ChannelCredentials;
    if (credentials.platform !== "telegram") return null;
    const chatId = credentials.telegram.chatId.trim();
    if (/^@[A-Za-z0-9_]{5,}$/.test(chatId)) return `https://t.me/${chatId.slice(1)}/${providerPostId}`;
    // A person often connects a public channel by its numeric -100… id.
    // t.me/c works only for private channels; ask Telegram for the current
    // public username before falling back to that private-channel form.
    const cached = telegramLinkPrefixCache.get(row.id);
    if (cached && cached.expiresAt > Date.now()) return cached.prefix ? `${cached.prefix}/${providerPostId}` : null;
    let pending = telegramLinkPrefixPending.get(row.id);
    if (!pending) {
      pending = (async () => {
        const response = await telegramGetChat(credentials.telegram.botToken, chatId);
        const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { username?: string } } | null;
        const username = payload?.ok ? payload.result?.username?.trim() : "";
        const prefix = username && /^[A-Za-z0-9_]{5,}$/.test(username)
          ? `https://t.me/${username}`
          : /^-100\d+$/.test(chatId) ? `https://t.me/c/${chatId.slice(4)}` : null;
        telegramLinkPrefixCache.set(row.id, { prefix, expiresAt: Date.now() + 5 * 60_000 });
        return prefix;
      })();
      telegramLinkPrefixPending.set(row.id, pending);
      void pending.then(
        () => telegramLinkPrefixPending.delete(row.id),
        () => telegramLinkPrefixPending.delete(row.id),
      );
    }
    const prefix = await pending;
    return prefix ? `${prefix}/${providerPostId}` : null;
  } catch {
    // Corrupted credentials are handled by the publish flow; they simply
    // cannot yield an inspectable Telegram URL here.
  }
  return null;
}
