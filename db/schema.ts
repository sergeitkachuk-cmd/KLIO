import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, real, text } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull().default("Пользователь"),
  // Null for accounts that only ever authenticated via the ChatGPT embed
  // (no site password was ever set for them).
  passwordHash: text("password_hash"),
  // Only meaningful for the password sign-in path — ChatGPT-embed accounts
  // are already vetted by OpenAI's own auth and never gate on this.
  emailVerified: boolean("email_verified").notNull().default(false),
  planId: text("plan_id").notNull().default("trial"),
  planExpiresAt: text("plan_expires_at"),
  // Anchors the monthly usage-quota reset to the payment date instead of
  // the calendar month (see nextQuotaPeriodEnd in api/_lib/subscription.ts
  // and the reset logic in api/_lib/workspace-account.ts's ensureAccount).
  // Null for the trial plan (governed by its own 48h wall-clock window) and
  // for paid plans an admin granted by hand without a real payment — those
  // fall back to the legacy calendar-month reset via generationMonth below.
  quotaPeriodEndsAt: text("quota_period_ends_at"),
  generationMonth: text("generation_month").notNull(),
  generationsUsed: integer("generations_used").notNull().default(0),
  researchUsed: integer("research_used").notNull().default(0),
  editorActionsUsed: integer("editor_actions_used").notNull().default(0),
  // Mirror the three counters above but never reset on the monthly
  // rollover in ensureAccount() — the "Ваша статистика" bar on the
  // workspace overview reads these for a lifetime total instead of the
  // current-period used-count the sidebar/plan quota widgets already show.
  lifetimeGenerationsUsed: integer("lifetime_generations_used").notNull().default(0),
  lifetimeResearchUsed: integer("lifetime_research_used").notNull().default(0),
  lifetimeEditorActionsUsed: integer("lifetime_editor_actions_used").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Payment links are persisted before they are sent to Tochka. The payment
// link id is also the idempotency key used by the webhook handler.
export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  planId: text("plan_id").notNull(),
  billing: text("billing").notNull(),
  mode: text("mode").notNull(),
  amountKopecks: integer("amount_kopecks").notNull(),
  status: text("status").notNull().default("pending"),
  operationId: text("operation_id"),
  paidAt: text("paid_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("payments_owner_created_idx").on(table.ownerEmail, table.createdAt),
  index("payments_status_idx").on(table.status, table.createdAt),
]);

// B2B invoices issued through Tochka. Keeping the source invoice and the
// resulting closing document together makes reconciliation and re-downloads
// idempotent after a payment has arrived.
export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  planId: text("plan_id").notNull(),
  billing: text("billing").notNull(),
  amountKopecks: integer("amount_kopecks").notNull(),
  tochkaDocumentId: text("tochka_document_id").notNull(),
  buyerType: text("buyer_type").notNull(),
  buyerName: text("buyer_name").notNull(),
  buyerInn: text("buyer_inn").notNull(),
  buyerKpp: text("buyer_kpp"),
  buyerLegalAddress: text("buyer_legal_address").notNull(),
  buyerEmail: text("buyer_email").notNull(),
  paymentStatus: text("payment_status").notNull().default("payment_waiting"),
  paidAt: text("paid_at"),
  closingDocumentId: text("closing_document_id"),
  closingStatus: text("closing_status"),
  closingSentAt: text("closing_sent_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("invoices_owner_created_idx").on(table.ownerEmail, table.createdAt),
  index("invoices_status_idx").on(table.paymentStatus, table.createdAt),
]);

export const sessions = pgTable("sessions", {
  // sha256 hex digest of the raw session token — the raw token only ever
  // lives in the visitor's cookie, never in the database.
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("sessions_email_idx").on(table.email),
]);

export const emailVerifications = pgTable("email_verifications", {
  // sha256 hex digest of the raw token — same pattern as sessions.id.
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("email_verifications_email_idx").on(table.email),
]);

export const passwordResets = pgTable("password_resets", {
  // SHA-256 digest of a one-time raw token sent by email.
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("password_resets_email_idx").on(table.email),
]);

export const brands = pgTable("brands", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  website: text("website").notNull().default(""),
  profileJson: text("profile_json").notNull(),
  workspaceJson: text("workspace_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("brands_owner_updated_idx").on(table.ownerEmail, table.updatedAt),
]);

export const generations = pgTable("generations", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  brandId: text("brand_id"),
  format: text("format").notNull(),
  topic: text("topic").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  metaTitle: text("meta_title").notNull().default(""),
  metaDescription: text("meta_description").notNull().default(""),
  editorialComment: text("editorial_comment").notNull().default(""),
  keywords: text("keywords").notNull().default(""),
  tone: text("tone").notNull().default(""),
  targetLength: integer("target_length").notNull().default(0),
  // Populated two ways: pasted/uploaded directly on a format:"external" row
  // added from the Публикации calendar (see app/api/publications/route.ts),
  // or attached later to any existing generation once KLIO generates images
  // itself. A plain URL into object storage, not the file — see
  // publishing-config.ts for why publishToChannel() needs a fetchable URL
  // rather than a local path.
  imageUrl: text("image_url").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("generations_owner_created_idx").on(table.ownerEmail, table.createdAt),
  index("generations_brand_created_idx").on(table.brandId, table.createdAt),
]);

// One row per AI call made through the router (app/api/_lib/ai-router.ts).
// Powers cost/latency accounting per user, brand, material and operation.
export const aiUsage = pgTable("ai_usage", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  brandId: text("brand_id"),
  materialId: text("material_id"),
  operation: text("operation").notNull(),
  model: text("model").notNull(),
  reasoningEffort: text("reasoning_effort").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  retryCount: integer("retry_count").notNull().default(0),
  // "success" | "failed" — see AiUsageStatus in ai-config.ts
  status: text("status").notNull(),
  // Set when a nano operation fell back to Luna after exhausting retries.
  fallbackFrom: text("fallback_from"),
  requestId: text("request_id"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("ai_usage_owner_created_idx").on(table.ownerEmail, table.createdAt),
  index("ai_usage_operation_idx").on(table.operation, table.createdAt),
]);

// Long-running AI work (currently just content-plan generation) that can
// legitimately take minutes — too long to trust any single HTTP request to
// stay open end to end (a hosting platform's reverse proxy enforces its own
// idle/duration timeout independent of anything this app does, and "failed
// to fetch" from a dropped connection was exactly what surfaced once plan
// generation got slow enough to occasionally cross it). The route that
// kicks off the work returns this row's id immediately; the actual AI call
// keeps running server-side (see the "why this is safe" note in
// app/api/_lib/async-jobs.ts) and the client polls /status until done.
export const asyncJobs = pgTable("async_jobs", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  // "content_plan" today; a plain string (not an enum) so a future job
  // kind doesn't need a migration to add.
  kind: text("kind").notNull(),
  // "pending" | "processing" | "done" | "failed"
  status: text("status").notNull().default("pending"),
  inputJson: text("input_json").notNull(),
  resultJson: text("result_json"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("async_jobs_owner_created_idx").on(table.ownerEmail, table.createdAt),
]);

// A brand's connected VK community or Telegram channel — see
// app/api/_lib/social-channels.ts for how these get created (always
// validated against the real platform first, never inserted from a bare
// paste) and app/api/_lib/publishing-config.ts for the credentialsJson
// shape per platform. One brand can hold several (a main community plus a
// regional one, VK alongside Telegram, ...) — never assumed to be 1:1.
export const socialChannels = pgTable("social_channels", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  brandId: text("brand_id").notNull(),
  // "telegram" | "vk" — see SocialPlatform in publishing-config.ts.
  platform: text("platform").notNull(),
  // Fetched from the platform itself at connect time (community/channel
  // name, avatar) so the picker in the calendar shows something recognizable
  // instead of an id — see fetchChannelInfo in social-channels.ts.
  label: text("label").notNull(),
  avatarUrl: text("avatar_url").notNull().default(""),
  // Bot token + chat id (Telegram) or community id + service token (VK).
  // Server-only — socialChannelSummary() in social-channels.ts is the only
  // shape ever sent to the client, and it omits this field entirely.
  credentialsJson: text("credentials_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("social_channels_brand_idx").on(table.brandId, table.createdAt),
  index("social_channels_owner_idx").on(table.ownerEmail, table.createdAt),
]);

// One row per (material, channel, scheduled time) — the same generation can
// go out to several channels, each tracked separately so one platform
// failing never blocks or hides the others. Publish target is always a
// `generations` row (real title+body+optional image), never a
// `materials` row — materials only ever holds semantics/competitors/
// content-plan research, which has nothing to actually post (see the
// schema comment on `materials` below and the "Публикации" design
// discussion: a content-plan row is a topic, not a written piece).
export const publications = pgTable("publications", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  brandId: text("brand_id").notNull(),
  generationId: text("generation_id").notNull(),
  channelId: text("channel_id").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  // "scheduled" | "publishing" | "published" | "failed" — see
  // PublicationStatus in publishing-config.ts. The cron poller
  // (api/cron/publish-due) claims a row by flipping scheduled->publishing
  // in one conditional UPDATE, so two overlapping runs can never both pick
  // it up.
  status: text("status").notNull().default("scheduled"),
  // The platform's own id for the published post (VK's post id, Telegram's
  // message_id) — kept for future "open on VK/Telegram" links and to tell
  // "published" states apart from each other in support conversations.
  providerPostId: text("provider_post_id"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  // What the cron poller scans: due, not-yet-attempted rows.
  index("publications_status_scheduled_idx").on(table.status, table.scheduledAt),
  // What the calendar screen queries: one brand's rows in a visible range.
  index("publications_brand_scheduled_idx").on(table.brandId, table.scheduledAt),
]);

export const materials = pgTable("materials", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  brandId: text("brand_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("Сохранено"),
  payloadJson: text("payload_json").notNull(),
  groupId: text("group_id").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("materials_owner_created_idx").on(table.ownerEmail, table.createdAt),
  index("materials_brand_created_idx").on(table.brandId, table.createdAt),
  index("materials_group_version_idx").on(table.groupId, table.versionNumber),
]);
