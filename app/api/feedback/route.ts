import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { feedbackMessages } from "../../../db/schema";
import { readBoundedJson, RequestBodyError } from "../_lib/request-body";
import { getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../_lib/workspace-account";
import { emailDeliveryAvailable, sendFeedbackNotificationEmail } from "../_lib/email";

const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_LIMIT = 50;

export async function GET() {
  try {
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const rows = await db.select().from(feedbackMessages).where(eq(feedbackMessages.ownerEmail, user.email)).orderBy(desc(feedbackMessages.createdAt)).limit(HISTORY_LIMIT);
    const unreadCount = rows.filter((row) => row.reply && !row.readAt).length;
    return Response.json({ messages: rows, unreadCount });
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
    if (emailDeliveryAvailable()) {
      const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      await Promise.allSettled(admins.map((admin) => sendFeedbackNotificationEmail(admin, { fromEmail: user.email, message })));
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
// clears the unread badge on "Задать вопрос".
export async function PATCH() {
  try {
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    await db.update(feedbackMessages).set({ readAt: new Date().toISOString() }).where(and(
      eq(feedbackMessages.ownerEmail, user.email),
      isNotNull(feedbackMessages.reply),
      isNull(feedbackMessages.readAt),
    ));
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Feedback mark-read failed");
    return Response.json({ error: "Не удалось обновить статус." }, { status: 502 });
  }
}
