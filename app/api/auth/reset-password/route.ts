import { hashPassword } from "../../_lib/password";
import { consumePasswordReset } from "../../_lib/password-reset";
import { workspaceDatabaseAvailable } from "../../_lib/workspace-account";
import { readBoundedBody, RequestBodyError } from "../../_lib/request-body";
import { isRateLimited, clientIp } from "../../_lib/rate-limit";

export async function POST(request: Request) {
  if (isRateLimited(`reset-password:${clientIp(request)}`, 10, 15 * 60_000)) return Response.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });
  let payload: { token?: unknown; password?: unknown } | null;
  try { payload = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, 4096))); }
  catch (error) { return Response.json({ error: "Некорректный запрос." }, { status: error instanceof RequestBodyError ? error.status : 400 }); }
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 8 || password.length > 256) return Response.json({ error: "Ссылка недействительна или длина пароля вне диапазона 8–256 символов." }, { status: 400 });
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
