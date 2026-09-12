// One publish attempt for one `publications` row — shared by the "Опубликовать
// сейчас" path in api/publications/route.ts (called inline, synchronously,
// so the person sees the real result immediately) and the cron poller in
// api/cron/publish-due/route.ts (called once per due row on its own
// schedule). Keeping this in one place means the retry/give-up/notify
// policy can't drift between the two call sites the way it would if each
// route re-implemented its own version.

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { generations, publications, socialChannels } from "../../../db/schema";
import { publishToChannel, PublishError } from "./social-publish";
import { MAX_PUBLISH_RETRIES } from "./publishing-config";
import { emailDeliveryAvailable, sendPublicationFailedEmail } from "./email";

export type PublishAttemptResult =
  | { status: "published"; providerPostId: string }
  | { status: "scheduled"; errorMessage: string }
  | { status: "failed"; errorMessage: string };

// `workspaceUrl` is only used for the failure email's "Открыть КЛИО" link —
// callers already have APP_BASE_URL resolved, no reason to re-derive it here.
//
// Claims the row itself (scheduled|failed -> publishing, in one conditional
// UPDATE) before doing anything else, so this is safe to call from both the
// cron poller (looping over every due row on its own timer) and the
// "Опубликовать сейчас" button (one row, right now) without the two ever
// racing to publish the same row twice — whichever call gets there first
// wins the claim, the other sees no row returned and stops. Returns null
// when there was nothing to claim: already mid-publish, already resolved,
// or the id doesn't exist.
export async function attemptPublish(publicationId: string, ownerEmail: string, workspaceUrl: string): Promise<PublishAttemptResult | null> {
  const db = getDb();
  const [publication] = await db.update(publications).set({
    status: "publishing",
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(and(
    eq(publications.id, publicationId),
    eq(publications.ownerEmail, ownerEmail),
    inArray(publications.status, ["scheduled", "failed"]),
  )).returning();
  if (!publication) return null;

  const [generation] = await db.select().from(generations).where(and(eq(generations.id, publication.generationId), eq(generations.ownerEmail, ownerEmail))).limit(1);
  const [channel] = await db.select().from(socialChannels).where(and(eq(socialChannels.id, publication.channelId), eq(socialChannels.ownerEmail, ownerEmail))).limit(1);
  if (!generation || !channel) {
    const errorMessage = "Материал или подключённый канал больше не существует.";
    await db.update(publications).set({ status: "failed", errorMessage, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(publications.id, publicationId));
    return { status: "failed", errorMessage };
  }

  let confirmedPostId: string | undefined;
  const persistSuccess = (providerPostId: string) => db.update(publications).set({
    status: "published", providerPostId, publishedAt: new Date().toISOString(),
    errorMessage: null, updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(and(eq(publications.id, publicationId), eq(publications.ownerEmail, ownerEmail), eq(publications.status, "publishing")));
  try {
    const result = await publishToChannel({
      platform: channel.platform,
      credentialsJson: channel.credentialsJson,
      text: `${generation.title}\n\n${generation.body}`.trim(),
      imageUrl: publication.telegramDeliveryMode === "text_only" ? null : generation.imageUrl || null,
    });
    confirmedPostId = result.providerPostId;
    await persistSuccess(confirmedPostId);
    return { status: "published", providerPostId: result.providerPostId };
  } catch (error) {
    if (confirmedPostId) {
      // Retry only the local receipt write, never the already-confirmed
      // external publication. If storage is still down, recovery marks
      // the old processing row uncertain instead of resending the post.
      await persistSuccess(confirmedPostId);
      return { status: "published", providerPostId: confirmedPostId };
    }
    const errorMessage = error instanceof PublishError ? error.message : "Не удалось подтвердить итог публикации. Перед повторной отправкой проверьте канал: запись могла быть опубликована.";
    const retryable = error instanceof PublishError ? error.retryable : false;
    const nextRetryCount = publication.retryCount + 1;
    const giveUp = !retryable || nextRetryCount >= MAX_PUBLISH_RETRIES;

    await db.update(publications).set({
      status: giveUp ? "failed" : "scheduled",
      retryCount: nextRetryCount,
      errorMessage,
      ...(error instanceof PublishError && error.providerPostId ? { providerPostId: error.providerPostId } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(publications.id, publicationId));

    if (giveUp && emailDeliveryAvailable()) {
      // Never let a notification failure mask the real publish failure
      // that's already being returned/logged below.
      await sendPublicationFailedEmail(ownerEmail, {
        channelLabel: channel.label,
        materialTitle: generation.title || "Без названия",
        reason: errorMessage,
        workspaceUrl,
      }).catch((emailError) => console.error("Failed to send publication-failed email", emailError));
    }

    return { status: giveUp ? "failed" : "scheduled", errorMessage };
  }
}
