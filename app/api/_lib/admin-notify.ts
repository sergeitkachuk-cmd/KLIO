import { telegramApiBase } from "./telegram-proxy";

// A dedicated bot for pinging the site owner directly in Telegram about new
// "Задать вопрос" submissions and confirmed payments — separate from any
// customer's own connected channel bot (social-channels.ts/social-publish.ts),
// which belongs to that customer, not to us. Reuses telegramApiBase() so this
// also goes through the self-hosted relay if TELEGRAM_PROXY_HOST/PORT are set
// (see telegram-proxy.ts) — same reachability fix, not a separate concern.
//
// Two-way: api/telegram/admin-webhook lets the owner *reply* to a
// notification from inside Telegram (matched back to the right feedback row
// by Telegram's own reply_to_message.message_id — see
// feedbackMessages.telegramMessageId in db/schema.ts) instead of only ever
// receiving a one-way ping.
export function adminTelegramAvailable() {
  return Boolean(process.env.ADMIN_TELEGRAM_BOT_TOKEN?.trim() && process.env.ADMIN_TELEGRAM_CHAT_ID?.trim());
}

function adminTelegramToken(): string {
  const token = process.env.ADMIN_TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("ADMIN_TELEGRAM_BOT_TOKEN не настроен.");
  return token;
}

// Best-effort — a failed notification here must never fail the request that
// triggered it; the message is already durably stored in the database and
// still visible in /admin regardless. Returns the sent message's own id so
// a caller (api/feedback/route.ts) can save it for the reply-matching above.
export async function sendAdminTelegramMessage(text: string, options?: { replyMarkup?: unknown }): Promise<{ messageId: number }> {
  const token = adminTelegramToken();
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID?.trim();
  if (!chatId) throw new Error("ADMIN_TELEGRAM_CHAT_ID не настроен.");
  const response = await fetch(`${telegramApiBase()}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string; result?: { message_id?: number } } | null;
  if (!response.ok || !payload?.ok || typeof payload.result?.message_id !== "number") {
    throw new Error(payload?.description || `Telegram API вернул ${response.status}`);
  }
  return { messageId: payload.result.message_id };
}

export function adminTelegramWebhookConfigured() {
  return Boolean(adminTelegramAvailable() && process.env.ADMIN_TELEGRAM_WEBHOOK_SECRET?.trim());
}

// Telegram includes this header verbatim on every webhook POST once a
// secret_token was registered via setWebhook below — the one thing standing
// between api/telegram/admin-webhook and anyone on the internet who finds
// its URL and POSTs a forged "reply" (which would otherwise let a stranger
// write into a customer's feedback thread).
export function verifyAdminTelegramWebhookSecret(headerValue: string | null): boolean {
  const expected = process.env.ADMIN_TELEGRAM_WEBHOOK_SECRET?.trim();
  return Boolean(expected && headerValue && headerValue === expected);
}

// Registers/clears api/telegram/admin-webhook as this bot's webhook target —
// a one-time setup action (visit that route's own GET, signed in as an
// admin) rather than something run automatically on every boot, since it's
// an external side effect (calling Telegram) that only ever needs to happen
// once, or again if the domain/secret changes.
export async function setAdminTelegramWebhook(url: string, secretToken: string): Promise<void> {
  const token = adminTelegramToken();
  const response = await fetch(`${telegramApiBase()}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message"] }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.description || `Telegram API вернул ${response.status}`);
}

export async function deleteAdminTelegramWebhook(): Promise<void> {
  const token = adminTelegramToken();
  const response = await fetch(`${telegramApiBase()}/bot${token}/deleteWebhook`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.description || `Telegram API вернул ${response.status}`);
}
