// Applying a reply to a "Задать вопрос" row - shared by the admin panel's
// own reply box (api/admin/feedback/route.ts) and a reply typed straight
// into Telegram (api/telegram/admin-webhook/route.ts), so the two entry
// points can't drift into different behavior (e.g. one clearing readAt to
// re-surface the unread badge and the other forgetting to).
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { feedbackMessages } from "../../../db/schema";
import { emailDeliveryAvailable, sendFeedbackRepliedEmail } from "./email";

const MAX_REPLY_LENGTH = 4000;

export async function applyFeedbackReply(id: string, rawReply: string, baseUrl: string) {
  const reply = rawReply.trim().slice(0, MAX_REPLY_LENGTH);
  if (!id || !reply) return null;

  const db = getDb();
  // readAt: null re-lights the customer's unread-reply badge on "Задать
  // вопрос" - same effect a fresh reply should have regardless of which
  // side (admin panel or Telegram) it came from.
  const [updated] = await db.update(feedbackMessages).set({ reply, repliedAt: new Date().toISOString(), readAt: null }).where(eq(feedbackMessages.id, id)).returning();
  if (!updated) return null;

  // Best-effort — the reply is already saved above regardless of whether
  // this notification goes out.
  if (emailDeliveryAvailable()) {
    await sendFeedbackRepliedEmail(updated.ownerEmail, `${baseUrl}/workspace`).catch(() => {
      console.error("Feedback reply notification failed");
    });
  }

  return updated;
}
