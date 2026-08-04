import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull().default("Пользователь"),
  // Null for accounts that only ever authenticated via the ChatGPT embed
  // (no site password was ever set for them).
  passwordHash: text("password_hash"),
  // Only meaningful for the password sign-in path — ChatGPT-embed accounts
  // are already vetted by OpenAI's own auth and never gate on this.
  emailVerified: boolean("email_verified").notNull().default(false),
  planId: text("plan_id").notNull().default("start"),
  generationMonth: text("generation_month").notNull(),
  generationsUsed: integer("generations_used").notNull().default(0),
  researchUsed: integer("research_used").notNull().default(0),
  editorActionsUsed: integer("editor_actions_used").notNull().default(0),
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
