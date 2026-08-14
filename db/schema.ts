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
