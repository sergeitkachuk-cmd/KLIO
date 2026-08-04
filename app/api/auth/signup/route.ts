import { eq } from "drizzle-orm";
import { accounts } from "../../../../db/schema";
import { hashPassword } from "../../_lib/password";
import { createSiteSession } from "../../../site-auth";
import { ensureAccount, getWorkspaceDb, workspaceDatabaseAvailable, workspaceErrorResponse } from "../../_lib/workspace-account";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SignupPayload = { email?: unknown; password?: unknown; displayName?: unknown };

export async function POST(request: Request) {
  try {
    if (!await workspaceDatabaseAvailable()) {
      return Response.json({ error: "Хранилище кабинета недоступно." }, { status: 503 });
    }

    const payload = await request.json() as SignupPayload;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 320) : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const displayName = typeof payload.displayName === "string" ? payload.displayName.trim().slice(0, 160) : "";

    if (!EMAIL_PATTERN.test(email)) {
      return Response.json({ error: "Укажите корректный email." }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json({ error: "Пароль должен быть не короче 8 символов." }, { status: 400 });
    }

    const name = displayName || email.split("@")[0];
    const account = await ensureAccount({ email, displayName: name, fullName: name });
    if (account.passwordHash) {
      return Response.json({ error: "Этот email уже зарегистрирован. Войдите в кабинет." }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const db = await getWorkspaceDb();
    await db.update(accounts).set({ passwordHash }).where(eq(accounts.email, email));
    await createSiteSession(email);

    return Response.json({ user: { email, displayName: name } }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
