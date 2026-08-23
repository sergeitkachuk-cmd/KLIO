import { hashPassword } from "../../_lib/password";
import { consumePasswordReset } from "../../_lib/password-reset";
import { workspaceDatabaseAvailable } from "../../_lib/workspace-account";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { token?: unknown; password?: unknown } | null;
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!token || password.length < 8) return Response.json({ error: "Ссылка недействительна или пароль короче 8 символов." }, { status: 400 });
  if (!await workspaceDatabaseAvailable()) return Response.json({ error: "Хранилище кабинета временно недоступно." }, { status: 503 });
  try {
    const valid = await consumePasswordReset(token, await hashPassword(password));
    if (!valid) return Response.json({ error: "Ссылка недействительна или уже устарела. Запросите новую." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Password reset failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Не удалось изменить пароль. Попробуйте позже." }, { status: 500 });
  }
}
