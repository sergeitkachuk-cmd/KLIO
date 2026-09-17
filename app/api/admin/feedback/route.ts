import { eq } from "drizzle-orm";
import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { getDb } from "../../../../db";
import { feedbackMessages } from "../../../../db/schema";
import { emailDeliveryAvailable, sendFeedbackRepliedEmail } from "../../_lib/email";

const MAX_REPLY_LENGTH = 4000;

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Недоступно" }, { status: 403 });

  const body = await request.json().catch(() => null) as { id?: unknown; reply?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const reply = typeof body?.reply === "string" ? body.reply.trim().slice(0, MAX_REPLY_LENGTH) : "";
  if (!id || !reply) return Response.json({ error: "Укажите обращение и текст ответа." }, { status: 400 });

  const db = getDb();
  const now = new Date().toISOString();
  const [updated] = await db.update(feedbackMessages).set({ reply, repliedAt: now, readAt: null }).where(eq(feedbackMessages.id, id)).returning();
  if (!updated) return Response.json({ error: "Обращение не найдено." }, { status: 404 });

  // Best-effort — the reply is already saved above regardless of whether
  // this notification goes out.
  if (emailDeliveryAvailable()) {
    const baseUrl = process.env.APP_BASE_URL?.trim() || new URL(request.url).origin;
    await sendFeedbackRepliedEmail(updated.ownerEmail, `${baseUrl}/workspace`).catch(() => {
      console.error("Feedback reply notification failed");
    });
  }

  return Response.json({ feedback: updated });
}
