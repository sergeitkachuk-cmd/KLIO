import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { applyFeedbackReply } from "../../_lib/feedback-reply";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Недоступно" }, { status: 403 });

  const body = await request.json().catch(() => null) as { id?: unknown; reply?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const reply = typeof body?.reply === "string" ? body.reply : "";
  if (!id || !reply.trim()) return Response.json({ error: "Укажите обращение и текст ответа." }, { status: 400 });

  const baseUrl = process.env.APP_BASE_URL?.trim() || new URL(request.url).origin;
  const updated = await applyFeedbackReply(id, reply, baseUrl);
  if (!updated) return Response.json({ error: "Обращение не найдено." }, { status: 404 });

  return Response.json({ feedback: updated });
}
