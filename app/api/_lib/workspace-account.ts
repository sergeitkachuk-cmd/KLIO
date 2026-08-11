import { and, eq, lt, sql } from "drizzle-orm";
import { accounts, brands, generations } from "../../../db/schema";
import { getDb } from "../../../db";
import type { ChatGPTUser } from "../../chatgpt-auth";
import { getCurrentUser } from "../../identity";
import { planRule } from "../../plans";

export class WorkspaceAccessError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function workspaceDatabaseAvailable() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function getWorkspaceDb() {
  if (!await workspaceDatabaseAvailable()) throw new WorkspaceAccessError("Хранилище кабинета недоступно.", 503);
  return getDb();
}

export async function workspaceIdentity(): Promise<ChatGPTUser> {
  const user = await getCurrentUser();
  if (user) return { ...user, fullName: user.displayName };
  if (process.env.NODE_ENV !== "production") {
    return { displayName: "Сергей", email: "preview@klio.local", fullName: "Сергей" };
  }
  throw new WorkspaceAccessError("Войдите в КЛИО, чтобы открыть личный кабинет.", 401);
}

function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function ensureAccount(user: ChatGPTUser) {
  const db = await getWorkspaceDb();
  const currentMonth = monthKey();
  let [account] = await db.select().from(accounts).where(eq(accounts.email, user.email)).limit(1);

  if (!account) {
    [account] = await db.insert(accounts).values({
      email: user.email,
      displayName: user.displayName,
      planId: "start",
      generationMonth: currentMonth,
      generationsUsed: 0,
      researchUsed: 0,
      editorActionsUsed: 0,
    }).returning();
  } else if (account.generationMonth !== currentMonth) {
    [account] = await db.update(accounts).set({
      displayName: user.displayName,
      generationMonth: currentMonth,
      generationsUsed: 0,
      researchUsed: 0,
      editorActionsUsed: 0,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(accounts.email, user.email)).returning();
  } else if (account.displayName !== user.displayName) {
    [account] = await db.update(accounts).set({
      displayName: user.displayName,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(accounts.email, user.email)).returning();
  }

  return account;
}

export function accountSummary(account: typeof accounts.$inferSelect, brandCount = 0) {
  const rule = planRule(account.planId);
  return {
    planId: rule.id,
    planName: rule.name,
    generationsUsed: account.generationsUsed,
    generationLimit: rule.generationLimit,
    generationsRemaining: Math.max(0, rule.generationLimit - account.generationsUsed),
    researchUsed: account.researchUsed,
    researchLimit: rule.researchLimit,
    researchRemaining: Math.max(0, rule.researchLimit - account.researchUsed),
    editorActionsUsed: account.editorActionsUsed,
    editorActionLimit: rule.editorActionLimit,
    editorActionsRemaining: Math.max(0, rule.editorActionLimit - account.editorActionsUsed),
    brandCount,
    brandLimit: rule.brandLimit,
    seatLimit: rule.seatLimit,
    period: account.generationMonth,
  };
}

async function currentBrandCount(email: string) {
  const db = await getWorkspaceDb();
  const [{ count = 0 } = { count: 0 }] = await db.select({ count: sql<number>`count(*)` }).from(brands).where(eq(brands.ownerEmail, email));
  return Number(count);
}

async function consumeSecondaryQuota(kind: "research" | "editor") {
  if (!await workspaceDatabaseAvailable()) return null;
  const user = await workspaceIdentity();
  const db = await getWorkspaceDb();
  const current = await ensureAccount(user);
  const rule = planRule(current.planId);

  const [updated] = kind === "research"
    ? await db.update(accounts).set({
      researchUsed: sql`${accounts.researchUsed} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(accounts.email, user.email),
      lt(accounts.researchUsed, rule.researchLimit),
    )).returning()
    : await db.update(accounts).set({
      editorActionsUsed: sql`${accounts.editorActionsUsed} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(accounts.email, user.email),
      lt(accounts.editorActionsUsed, rule.editorActionLimit),
    )).returning();

  if (!updated) {
    const label = kind === "research" ? "исследований" : "редакторских действий";
    const limit = kind === "research" ? rule.researchLimit : rule.editorActionLimit;
    throw new WorkspaceAccessError(`Лимит тарифа «${rule.name}» исчерпан: ${limit} ${label} в месяц.`, 429);
  }

  return { account: accountSummary(updated, await currentBrandCount(user.email)) };
}

// Mirrors assertSecondaryQuotaAvailable but for the primary "generation"
// counter — called before the (costly) OpenAI request in /api/generate so
// an account that's already over its monthly limit doesn't still burn a
// real generation call only to have recordGeneration() reject it afterward.
export async function assertGenerationQuotaAvailable() {
  if (!await workspaceDatabaseAvailable()) return;
  const user = await workspaceIdentity();
  const current = await ensureAccount(user);
  const rule = planRule(current.planId);
  if (current.generationsUsed >= rule.generationLimit) {
    throw new WorkspaceAccessError(`Лимит тарифа «${rule.name}» исчерпан: ${rule.generationLimit} материалов в месяц.`, 429);
  }
}

export async function assertSecondaryQuotaAvailable(kind: "research" | "editor") {
  if (!await workspaceDatabaseAvailable()) return;
  const user = await workspaceIdentity();
  const current = await ensureAccount(user);
  const rule = planRule(current.planId);
  const used = kind === "research" ? current.researchUsed : current.editorActionsUsed;
  const limit = kind === "research" ? rule.researchLimit : rule.editorActionLimit;
  if (used >= limit) {
    const label = kind === "research" ? "исследований" : "редакторских действий";
    throw new WorkspaceAccessError(`Лимит тарифа «${rule.name}» исчерпан: ${limit} ${label} в месяц.`, 429);
  }
}

export async function recordResearch() {
  return consumeSecondaryQuota("research");
}

export async function recordEditorialAction() {
  return consumeSecondaryQuota("editor");
}

export type ArchiveMaterial = {
  brandId?: string;
  format: string;
  topic: string;
  title: string;
  body: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
  editorialComment: string;
  keywords: string;
  tone: string;
  targetLength: number;
};

export async function recordGeneration(material: ArchiveMaterial) {
  if (!await workspaceDatabaseAvailable()) return null;
  const user = await workspaceIdentity();
  const db = await getWorkspaceDb();
  const current = await ensureAccount(user);
  const rule = planRule(current.planId);
  const [updated] = await db.update(accounts).set({
    generationsUsed: sql`${accounts.generationsUsed} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(and(
    eq(accounts.email, user.email),
    lt(accounts.generationsUsed, rule.generationLimit),
  )).returning();

  if (!updated) {
    throw new WorkspaceAccessError(`Лимит тарифа «${rule.name}» исчерпан: ${rule.generationLimit} материалов в месяц.`, 429);
  }

  let brandId: string | null = null;
  if (material.brandId) {
    const [ownedBrand] = await db.select({ id: brands.id }).from(brands).where(and(
      eq(brands.id, material.brandId),
      eq(brands.ownerEmail, user.email),
    )).limit(1);
    brandId = ownedBrand?.id ?? null;
  }

  const [archive] = await db.insert(generations).values({
    id: crypto.randomUUID(),
    ownerEmail: user.email,
    brandId,
    format: material.format,
    topic: material.topic,
    title: material.title,
    body: material.body,
    subtitle: material.subtitle,
    metaTitle: material.metaTitle,
    metaDescription: material.metaDescription,
    editorialComment: material.editorialComment,
    keywords: material.keywords,
    tone: material.tone,
    targetLength: material.targetLength,
  }).returning();

  const [{ count: brandCount = 0 } = { count: 0 }] = await db.select({ count: sql<number>`count(*)` }).from(brands).where(eq(brands.ownerEmail, user.email));
  return { account: accountSummary(updated, Number(brandCount)), archive };
}

export function workspaceErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (/does not exist|DATABASE_URL/i.test(message)) {
    return Response.json({ error: "Хранилище кабинета ещё не подготовлено. Повторите попытку после обновления сайта." }, { status: 503 });
  }
  console.error("Workspace persistence failed", error);
  return Response.json({ error: "Не удалось сохранить данные кабинета." }, { status: 500 });
}
