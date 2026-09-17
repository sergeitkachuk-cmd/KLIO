import { telegramApiBase } from "./telegram-proxy";

// A dedicated bot for pinging the site owner directly in Telegram about new
// "Задать вопрос" submissions — separate from any customer's own connected
// channel bot (social-channels.ts/social-publish.ts), which belongs to that
// customer, not to us. Reuses telegramApiBase() so this also goes through
// the self-hosted relay if TELEGRAM_PROXY_HOST/PORT are set (see
// telegram-proxy.ts) — same reachability fix, not a separate concern.
export function adminTelegramAvailable() {
  return Boolean(process.env.ADMIN_TELEGRAM_BOT_TOKEN?.trim() && process.env.ADMIN_TELEGRAM_CHAT_ID?.trim());
}

// Best-effort — a failed notification here must never fail the request that
// triggered it; the message is already durably stored in the database and
// still visible in /admin regardless.
export async function sendAdminTelegramMessage(text: string) {
  const token = process.env.ADMIN_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) throw new Error("ADMIN_TELEGRAM_BOT_TOKEN/ADMIN_TELEGRAM_CHAT_ID не настроены.");
  const response = await fetch(`${telegramApiBase()}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.description || `Telegram API вернул ${response.status}`);
}
