import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { accounts, announcements, feedbackMessages } from "../../../db/schema";
import { readBoundedJson, RequestBodyError } from "../_lib/request-body";
import { ensureAccount, getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../_lib/workspace-account";
import { emailDeliveryAvailable, sendFeedbackNotificationEmail } from "../_lib/email";
import { adminTelegramAvailable, sendAdminTelegramMessage } from "../_lib/admin-notify";

const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_LIMIT = 50;
const ANNOUNCEMENT_LIMIT = 30;

export async function GET() {
  try {
    const user = await workspaceIdentity();
    const account = await ensureAccount(user);
    const db = await getWorkspaceDb();
    const [messages, announcementRows] = await Promise.all([
      db.select().from(feedbackMessages).where(eq(feedbackMessages.ownerEmail, user.email)).orderBy(desc(feedbackMessages.createdAt)).limit(HISTORY_LIMIT),
      db.select().from(announcements).where(or(isNull(announcements.recipientEmail), eq(announcements.recipientEmail, user.email))).orderBy(desc(announcements.createdAt)).limit(ANNOUNCEMENT_LIMIT),
    ]);
    const unreadRepliesCount = messages.filter((row) => row.reply && !row.readAt).length;
    const seenAnnouncementsAt = account.lastSeenAnnouncementAt ?? account.createdAt;
    const unreadAnnouncementsCount = announcementRows.filter((row) => new Date(row.createdAt).getTime() > new Date(seenAnnouncementsAt).getTime()).length;
    // Separate counts, not one combined total - "Новости" and "Обращения"
    // are now two distinct account-menu rows (site owner: "разными
    // строками в меню лк, а не разными вкладками в одной"), each with its
    // own badge.
    return Response.json({ messages, announcements: announcementRows, unreadRepliesCount, unreadAnnouncementsCount });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Feedback history load failed");
    return Response.json({ error: "Не удалось загрузить обращения." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await workspaceIdentity();
    const input = await readBoundedJson(request, 8192);
    const message = typeof input?.message === "string" ? input.message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
    if (!message) return Response.json({ error: "Напишите сообщение." }, { status: 400 });

    const db = await getWorkspaceDb();
    const feedbackId = randomUUID();
    await db.insert(feedbackMessages).values({ id: feedbackId, ownerEmail: user.email, message });

    // Best-effort — the message is already durably stored above, so a
    // notification failure (missing config, provider outage) must not turn
    // into an error the visitor sees; it just surfaces later in /admin.
    // Telegram alongside email, not instead of it — site owner: "чтобы их
    // не пропустил", a faster/harder-to-miss channel than an inbox.
    if (emailDeliveryAvailable()) {
      const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      await Promise.allSettled(admins.map((admin) => sendFeedbackNotificationEmail(admin, { fromEmail: user.email, message })));
    }
    // Logs which of the two failure shapes actually happened - silently
    // skipped (adminTelegramAvailable() false, so the env vars aren't what
    // this running process actually sees, panel display notwithstanding)
    // vs. attempted and rejected by Telegram/the network (previously
    // logged as a bare "failed" with the real reason discarded, which made
    // a real production incident - the notification config looking right
    // in every way that could be checked, but nothing arriving - undiagnosable
    // without this).
    if (adminTelegramAvailable()) {
      // Saving telegramMessageId is what lets api/telegram/admin-webhook
      // match a reply typed in Telegram back to this exact row (Telegram
      // echoes it as reply_to_message.message_id) - worth a second small
      // write, not worth blocking/failing the visitor's submission over if
      // it doesn't happen.
      await sendAdminTelegramMessage(`Новое обращение в КЛИО\nОт: ${user.email}\n\n${message}`)
        .then(({ messageId }) => db.update(feedbackMessages).set({ telegramMessageId: String(messageId) }).where(eq(feedbackMessages.id, feedbackId)))
        .catch((error) => {
          // A raw fetch() rejection (network/DNS/timeout, as opposed to
          // Telegram itself answering with an error body) carries the real
          // reason in .cause, not .message - same shape already relied on
          // in social-channels.ts's telegramGetChat failure log.
          const cause = error instanceof Error ? error.cause : undefined;
          console.error("Admin Telegram notify failed", {
            message: error instanceof Error ? error.message : String(error),
            cause: cause instanceof Error ? cause.message : cause,
          });
        });
    } else {
      console.error("Admin Telegram notify skipped: ADMIN_TELEGRAM_BOT_TOKEN/ADMIN_TELEGRAM_CHAT_ID not seen by this process");
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Feedback submit failed");
    return Response.json({ error: "Не удалось отправить сообщение. Попробуйте ещё раз." }, { status: 502 });
  }
}

// Called when either modal is actually opened (not just on the background
// badge-count fetch above) — that's the "seen" moment that clears that
// specific row's own unread badge. "Новости" and "Обращения" are separate
// account-menu rows now, so each only ever marks its own kind - opening
// one must never silently clear the other's badge too.
export async function PATCH(request: Request) {
  try {
    const user = await workspaceIdentity();
    const body = await request.json().catch(() => null) as { kind?: unknown } | null;
    const kind = body?.kind === "news" ? "news" : "support";
    const db = await getWorkspaceDb();
    const now = new Date().toISOString();
    if (kind === "support") {
      await db.update(feedbackMessages).set({ readAt: now }).where(and(
        eq(feedbackMessages.ownerEmail, user.email),
        isNotNull(feedbackMessages.reply),
        isNull(feedbackMessages.readAt),
      ));
    } else {
      await db.update(accounts).set({ lastSeenAnnouncementAt: now }).where(eq(accounts.email, user.email));
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Feedback mark-read failed");
    return Response.json({ error: "Не удалось обновить статус." }, { status: 502 });
  }
}
