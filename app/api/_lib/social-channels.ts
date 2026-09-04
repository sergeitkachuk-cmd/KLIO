// Validates a VK/Telegram connection against the real platform before it is
// ever written to the socialChannels table — a channel row only exists here
// once we have proof the credentials actually work, never from a bare
// unchecked paste. Also the one place that decides what's safe to hand back
// to the browser (socialChannelSummary strips credentialsJson unconditionally
// — see the comment on that column in db/schema.ts).

import { VK_API_VERSION, type ChannelCredentials } from "./publishing-config";
import { socialChannels } from "../../../db/schema";

export class ChannelValidationError extends Error {}

// getChat does not change anything in Telegram, so one short retry is safe:
// it smooths over a transient DNS/TLS failure without risking duplicate posts.
async function telegramGetChat(botToken: string, chatId: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId }),
        signal: AbortSignal.timeout(15_000),
      });
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
    throw new ChannelValidationError("Не удалось связаться с Telegram. Проверьте токен бота.");
  }
}

async function describeVkChannel(vk: { groupId: string; accessToken: string }): Promise<{ label: string; avatarUrl: string }> {
  if (!vk.groupId.trim() || !vk.accessToken.trim()) {
    throw new ChannelValidationError("Укажите id сообщества и токен доступа.");
  }
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
  return { label: group.name, avatarUrl: typeof group.photo_200 === "string" ? group.photo_200 : "" };
}

// Throws ChannelValidationError (safe to show verbatim to the user) on
// anything wrong with the credentials themselves; anything else (network,
// malformed platform response) is wrapped into the same error type so the
// connect route has exactly one error shape to handle.
export async function describeChannel(credentials: ChannelCredentials): Promise<{ label: string; avatarUrl: string }> {
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
