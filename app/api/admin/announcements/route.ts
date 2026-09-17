import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { getDb } from "../../../../db";
import { accounts, announcements } from "../../../../db/schema";

const MAX_MESSAGE_LENGTH = 4000;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Недоступно" }, { status: 403 });

  const body = await request.json().catch(() => null) as { message?: unknown; recipientEmail?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  const recipientEmail = typeof body?.recipientEmail === "string" ? body.recipientEmail.trim().toLowerCase() : "";
  if (!message) return Response.json({ error: "Напишите сообщение." }, { status: 400 });

  const db = getDb();
  if (recipientEmail) {
    const [recipient] = await db.select({ email: accounts.email }).from(accounts).where(eq(accounts.email, recipientEmail)).limit(1);
    if (!recipient) return Response.json({ error: "Клиент с таким email не найден." }, { status: 404 });
  }

  const [created] = await db.insert(announcements).values({
    id: randomUUID(),
    message,
    recipientEmail: recipientEmail || null,
  }).returning();

  return Response.json({ announcement: created });
}
