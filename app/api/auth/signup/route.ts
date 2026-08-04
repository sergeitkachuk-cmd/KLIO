import { eq } from "drizzle-orm";
import { accounts } from "../../../../db/schema";
import { hashPassword } from "../../_lib/password";
import { emailDeliveryAvailable, sendVerificationEmail } from "../../_lib/email";
import { clientIp, isRateLimited } from "../../_lib/rate-limit";
import { createEmailVerification } from "../../_lib/verification";
import { ensureAccount, getWorkspaceDb, workspaceDatabaseAvailable, workspaceErrorResponse } from "../../_lib/workspace-account";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SignupPayload = { email?: unknown; password?: unknown; displayName?: unknown };

export async function POST(request: Request) {
  try {
    if (isRateLimited(`signup:${clientIp(request)}`, 8, 10 * 60 * 1000)) {
      return Response.json({ error: "Слишком много попыток регистрации. Попробуйте через несколько минут." }, { status: 429 });
    }
    if (!await workspaceDatabaseAvailable()) {
      return Response.json({ error: "Хранилище кабинета недоступно." }, { status: 503 });
    }
    if (!emailDeliveryAvailable()) {
      return Response.json({ error: "Отправка писем ещё не настроена. Обратитесь к администратору сайта." }, { status: 503 });
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
    if (account.passwordHash && account.emailVerified) {
      return Response.json({ error: "Этот email уже зарегистрирован. Войдите в кабинет." }, { status: 409 });
    }

    // Either a brand-new signup, or a retry for an account whose email was
    // never verified (lost email, typo first time, bot filled a real
    // address) — in both cases we (re)send a fresh verification link rather
    // than dead-ending the visitor.
    const passwordHash = await hashPassword(password);
    const db = await getWorkspaceDb();
    await db.update(accounts).set({ passwordHash }).where(eq(accounts.email, email));

    const token = await createEmailVerification(email);
    const verifyUrl = new URL(`/api/auth/verify?token=${token}`, request.url).toString();
    try {
      await sendVerificationEmail(email, verifyUrl);
    } catch (error) {
      console.error("Failed to send verification email", error);
      return Response.json({ error: "Не удалось отправить письмо подтверждения. Попробуйте ещё раз чуть позже." }, { status: 502 });
    }

    return Response.json({ status: "verify_email", email }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
