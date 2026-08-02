import { sql } from "drizzle-orm";
import { index, integer, pgTable, text } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull().default("Пользователь"),
  planId: text("plan_id").notNull().default("start"),
  generationMonth: text("generation_month").notNull(),
  generationsUsed: integer("generations_used").notNull().default(0),
  researchUsed: integer("research_used").notNull().default(0),
  editorActionsUsed: integer("editor_actions_used").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
