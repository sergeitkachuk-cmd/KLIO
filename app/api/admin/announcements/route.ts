import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { getDb } from "../../../../db";
import { accounts, announcements } from "../../../../db/schema";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_RECIPIENTS = 200;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Недоступно" }, { status: 403 });

  const body = await request.json().catch(() => null) as { message?: unknown; recipientEmails?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  if (!message) return Response.json({ error: "Напишите сообщение." }, { status: 400 });

  // Empty/omitted list means the broadcast case (one row, recipientEmail
  // null) - the admin-announcements.tsx picker's own "no chips selected"
  // state. Deduped since the picker itself already prevents adding the
  // same person twice, but a client is never trusted on that.
  const rawEmails = Array.isArray(body?.recipientEmails) ? body.recipientEmails : [];
  const recipientEmails = [...new Set(
    rawEmails.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean),
  )].slice(0, MAX_RECIPIENTS);

  const db = getDb();
  if (recipientEmails.length > 0) {
    const found = await db.select({ email: accounts.email }).from(accounts).where(inArray(accounts.email, recipientEmails));
    const foundEmails = new Set(found.map((item) => item.email));
    const missing = recipientEmails.filter((email) => !foundEmails.has(email));
    if (missing.length) return Response.json({ error: `Клиенты не найдены: ${missing.join(", ")}` }, { status: 404 });
  }

  // One row per specific recipient (unchanged storage shape - the customer
  // side already filters recipientEmail null OR = own email, per row) so a
  // multi-recipient send needs no schema change, just a fan-out insert.
  const targets = recipientEmails.length > 0 ? recipientEmails : [null];
  const created = await db.insert(announcements).values(
    targets.map((recipientEmail) => ({ id: randomUUID(), message, recipientEmail })),
  ).returning();

  return Response.json({ announcements: created });
}
