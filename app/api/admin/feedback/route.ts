import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { applyFeedbackReply } from "../../_lib/feedback-reply";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { feedbackMessages } from "../../../../db/schema";
import { readBoundedJson, RequestBodyError } from "../../_lib/request-body";
import { hasUnsafeRequestOrigin } from "../../_lib/request-origin";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Недоступно" }, { status: 403 });

  const body = await request.json().catch(() => null) as { ownerEmail?: unknown; reply?: unknown } | null;
  const ownerEmail = typeof body?.ownerEmail === "string" ? body.ownerEmail.trim() : "";
  const reply = typeof body?.reply === "string" ? body.reply : "";
  if (!ownerEmail || !reply.trim()) return Response.json({ error: "Укажите обращение и текст ответа." }, { status: 400 });

  const baseUrl = process.env.APP_BASE_URL?.trim() || new URL(request.url).origin;
  const inserted = await applyFeedbackReply(ownerEmail, reply, baseUrl);
  if (!inserted) return Response.json({ error: "Не удалось отправить ответ." }, { status: 502 });

  return Response.json({ feedback: inserted });
}

export async function DELETE(request: Request) {
  if (hasUnsafeRequestOrigin(request)) return Response.json({ error: "Недопустимый источник запроса." }, { status: 403 });
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Недоступно" }, { status: 403 });

  try {
    const body = await readBoundedJson(request, 2048);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";
    if (!id || id.length > 100 || !ownerEmail || ownerEmail.length > 320) {
      return Response.json({ error: "Укажите сообщение и переписку." }, { status: 400 });
    }
    // Only operator replies can be removed; client messages and bot
    // acknowledgements are never affected, nor is any other conversation.
    const [deleted] = await getDb().delete(feedbackMessages).where(and(
      eq(feedbackMessages.id, id),
      eq(feedbackMessages.ownerEmail, ownerEmail),
      eq(feedbackMessages.sender, "admin"),
    )).returning({ id: feedbackMessages.id });
    if (!deleted) return Response.json({ error: "Ответ не найден или уже удалён." }, { status: 404 });
    return Response.json({ deletedId: deleted.id });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Feedback delete failed");
    return Response.json({ error: "Не удалось удалить ответ. Попробуйте ещё раз." }, { status: 502 });
  }
}
