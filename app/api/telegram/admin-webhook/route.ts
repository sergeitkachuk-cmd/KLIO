// Receives Telegram's Update callbacks for the admin-notify bot (see
// api/_lib/admin-notify.ts) and lets the site owner reply to a "Задать
// вопрос" submission by replying to its Telegram notification, instead of
// only ever being able to receive a one-way ping. GET registers/clears this
// route as the bot's webhook target — a one-time setup action, not
// something a visitor or Telegram itself ever calls.
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { feedbackMessages } from "../../../../db/schema";
import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { resolveBaseUrl } from "../../_lib/base-url";
import { readBoundedBody, RequestBodyError } from "../../_lib/request-body";
import { applyFeedbackReply } from "../../_lib/feedback-reply";
import {
  adminTelegramWebhookConfigured,
  deleteAdminTelegramWebhook,
  sendAdminTelegramMessage,
  setAdminTelegramWebhook,
  verifyAdminTelegramWebhookSecret,
} from "../../_lib/admin-notify";

const MAX_UPDATE_BYTES = 32_768;

type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    reply_to_message?: { message_id: number };
  };
};

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Недоступно" }, { status: 403 });

  const secret = process.env.ADMIN_TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ error: "Задайте ADMIN_TELEGRAM_WEBHOOK_SECRET (любая случайная строка) и передеплойте перед регистрацией." }, { status: 400 });

  const action = new URL(request.url).searchParams.get("action") === "unregister" ? "unregister" : "register";
  try {
    if (action === "unregister") {
      await deleteAdminTelegramWebhook();
      return Response.json({ ok: true, action });
    }
    const url = new URL("/api/telegram/admin-webhook", resolveBaseUrl(request)).href;
    await setAdminTelegramWebhook(url, secret);
    return Response.json({ ok: true, action, url });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось обновить webhook." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  // Telegram doesn't retry on a 200 the way it does on a real 5xx - every
  // exit below is 200 except a genuinely unexpected failure, so a message
  // Telegram is unhappy with (missing reply_to_message, unknown chat, no
  // matching feedback row) is acknowledged once and dropped, not retried
  // forever with the same outcome each time.
  if (!adminTelegramWebhookConfigured()) return new Response(null, { status: 200 });
  if (!verifyAdminTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response(null, { status: 403 });
  }

  try {
    const bytes = await readBoundedBody(request, MAX_UPDATE_BYTES);
    const update = JSON.parse(new TextDecoder().decode(bytes)) as TelegramUpdate;
    const message = update.message;
    const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID!.trim();
    // Only the owner's own chat with this bot ever does anything here -
    // the secret-token check above already keeps out anyone who isn't
    // Telegram itself, this keeps out any *other* chat that bot happens to
    // be in (a group it was added to, a stray DM from someone else).
    if (!message || String(message.chat.id) !== adminChatId) return new Response(null, { status: 200 });

    const text = (message.text ?? "").trim();
    const replyToId = message.reply_to_message?.message_id;
    if (!text || !replyToId) {
      await sendAdminTelegramMessage("Чтобы отправить ответ клиенту, ответьте (Reply) прямо на уведомление об его обращении.").catch(() => {});
      return new Response(null, { status: 200 });
    }

    const db = getDb();
    const [row] = await db.select({ id: feedbackMessages.id, ownerEmail: feedbackMessages.ownerEmail })
      .from(feedbackMessages).where(eq(feedbackMessages.telegramMessageId, String(replyToId))).limit(1);
    if (!row) {
      await sendAdminTelegramMessage("Не нашёл обращение для этого сообщения — похоже, это ответ не на уведомление, а на что-то другое.").catch(() => {});
      return new Response(null, { status: 200 });
    }

    const baseUrl = resolveBaseUrl(request);
    const updated = await applyFeedbackReply(row.id, text, baseUrl);
    await sendAdminTelegramMessage(updated ? `Ответ отправлен клиенту ${row.ownerEmail}.` : "Не удалось сохранить ответ — обращение уже не найдено.").catch(() => {});
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof RequestBodyError) return new Response(null, { status: error.status });
    console.error("Admin Telegram webhook failed", error instanceof Error ? error.message : error);
    return new Response(null, { status: 500 });
  }
}
