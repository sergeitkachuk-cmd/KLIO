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
    const unreadReplies = messages.filter((row) => row.reply && !row.readAt).length;
    const seenAnnouncementsAt = account.lastSeenAnnouncementAt ?? account.createdAt;
    const unreadAnnouncements = announcementRows.filter((row) => new Date(row.createdAt).getTime() > new Date(seenAnnouncementsAt).getTime()).length;
    return Response.json({ messages, announcements: announcementRows, unreadCount: unreadReplies + unreadAnnouncements });
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
    await db.insert(feedbackMessages).values({ id: randomUUID(), ownerEmail: user.email, message });

    // Best-effort — the message is already durably stored above, so a
    // notification failure (missing config, provider outage) must not turn
    // into an error the visitor sees; it just surfaces later in /admin.
    // Telegram alongside email, not instead of it — site owner: "чтобы их
    // не пропустил", a faster/harder-to-miss channel than an inbox.
    if (emailDeliveryAvailable()) {
      const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      await Promise.allSettled(admins.map((admin) => sendFeedbackNotificationEmail(admin, { fromEmail: user.email, message })));
    }
    if (adminTelegramAvailable()) {
      await sendAdminTelegramMessage(`Новое обращение в КЛИО\nОт: ${user.email}\n\n${message}`).catch(() => {
        console.error("Admin Telegram notify failed");
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Feedback submit failed");
    return Response.json({ error: "Не удалось отправить сообщение. Попробуйте ещё раз." }, { status: 502 });
  }
}

// Called when the workspace modal is actually opened (not just on the
// background badge-count fetch above) — that's the "seen" moment that
// clears the unread badge on "Задать вопрос" for both replies and
// announcements.
export async function PATCH() {
  try {
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const now = new Date().toISOString();
    await Promise.all([
      db.update(feedbackMessages).set({ readAt: now }).where(and(
        eq(feedbackMessages.ownerEmail, user.email),
        isNotNull(feedbackMessages.reply),
        isNull(feedbackMessages.readAt),
      )),
      db.update(accounts).set({ lastSeenAnnouncementAt: now }).where(eq(accounts.email, user.email)),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Feedback mark-read failed");
    return Response.json({ error: "Не удалось обновить статус." }, { status: 502 });
  }
}
