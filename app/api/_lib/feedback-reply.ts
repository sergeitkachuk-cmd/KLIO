// Applying an admin reply to a "Задать вопрос" thread - shared by the admin
// panel's own reply box (api/admin/feedback/route.ts) and a reply typed
// straight into Telegram (api/telegram/admin-webhook/route.ts), so the two
// entry points can't drift into different behavior. Keyed by ownerEmail
// (the thread), not a message id - a reply is now its own new row in that
// customer's conversation, same shape as every other message in it, not an
// update to one specific row (see feedbackMessages in db/schema.ts for why:
// the whole point of the redesign is an ordered thread, not disconnected
// Q&A pairs).
import { randomUUID } from "node:crypto";
import { getDb } from "../../../db";
import { feedbackMessages } from "../../../db/schema";
import { emailDeliveryAvailable, sendFeedbackRepliedEmail } from "./email";

const MAX_REPLY_LENGTH = 4000;

export async function applyFeedbackReply(ownerEmail: string, rawReply: string, baseUrl: string) {
  const body = rawReply.trim().slice(0, MAX_REPLY_LENGTH);
  if (!ownerEmail || !body) return null;

  const db = getDb();
  const [inserted] = await db.insert(feedbackMessages).values({
    id: randomUUID(),
    ownerEmail,
    sender: "admin",
    body,
  }).returning();
  if (!inserted) return null;

  // Best-effort — the reply is already saved above regardless of whether
  // this notification goes out.
  if (emailDeliveryAvailable()) {
    await sendFeedbackRepliedEmail(ownerEmail, `${baseUrl}/workspace`).catch(() => {
      console.error("Feedback reply notification failed");
    });
  }

  return inserted;
}
