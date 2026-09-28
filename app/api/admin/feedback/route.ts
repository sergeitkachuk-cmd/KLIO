import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { applyFeedbackReply } from "../../_lib/feedback-reply";

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
