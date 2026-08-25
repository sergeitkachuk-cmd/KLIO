import { and, eq, lt, sql } from "drizzle-orm";
import { accounts, brands, generations } from "../../../db/schema";
import { getDb } from "../../../db";
import type { ChatGPTUser } from "../../chatgpt-auth";
import { getCurrentUser } from "../../identity";
import { planRule, planExpiryState } from "../../plans";
import { nextQuotaPeriodEnd } from "./subscription";

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

// True once the current usage-quota period (generationsUsed/researchUsed/
// editorActionsUsed) needs zeroing again. Accounts that went through a real
// payment carry quotaPeriodEndsAt, anchored to the payment date — the trial
// plan and any paid plan an admin granted by hand without one fall back to
// the legacy plain calendar-month comparison instead.
function quotaPeriodElapsed(account: typeof accounts.$inferSelect, now: Date) {
  if (account.quotaPeriodEndsAt) {
    const endsAt = new Date(account.quotaPeriodEndsAt).getTime();
    return Number.isFinite(endsAt) && now.getTime() >= endsAt;
  }
  return account.generationMonth !== monthKey(now);
}

// Product-owner test account. Kept narrowly scoped so production limits and
// the trial window remain unchanged for every other user.
const TEST_ACCOUNT_EMAIL = "sergeitkachuk@gmail.com";

function isTestAccount(email: string) {
  return email.trim().toLocaleLowerCase("en-US") === TEST_ACCOUNT_EMAIL;
}

export async function ensureAccount(user: ChatGPTUser) {
  const db = await getWorkspaceDb();
  const now = new Date();
  const currentMonth = monthKey(now);
  let [account] = await db.select().from(accounts).where(eq(accounts.email, user.email)).limit(1);

  if (!account) {
    [account] = await db.insert(accounts).values({
      email: user.email,
      displayName: user.displayName,
      planId: isTestAccount(user.email) ? "agency" : "trial",
      generationMonth: currentMonth,
      generationsUsed: 0,
      researchUsed: 0,
      editorActionsUsed: 0,
      lifetimeGenerationsUsed: 0,
      lifetimeResearchUsed: 0,
      lifetimeEditorActionsUsed: 0,
    }).returning();
  } else if (quotaPeriodElapsed(account, now)) {
    // Payment-anchored accounts advance from their own previous anchor (not
    // from `now`) so the reset day-of-month stays pinned to the original
    // payment date even if nobody visits exactly on the boundary; a visit
    // that's overdue by more than one period catches up fully on the next
    // request after this one (each step is a harmless no-op once counters
    // are already zero). Only the three period counters reset here —
    // lifetimeGenerationsUsed/lifetimeResearchUsed/lifetimeEditorActionsUsed
    // are deliberately absent from this set() so the rollover never touches
    // them.
    const nextAnchor = account.quotaPeriodEndsAt ? nextQuotaPeriodEnd(new Date(account.quotaPeriodEndsAt)) : null;
    [account] = await db.update(accounts).set({
      displayName: user.displayName,
      generationMonth: currentMonth,
      quotaPeriodEndsAt: nextAnchor,
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

  if (isTestAccount(user.email) && account.planId !== "agency") {
    [account] = await db.update(accounts).set({
      planId: "agency",
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(accounts.email, user.email)).returning();
  }

  return account;
}

function isPaidPlanExpired(account: typeof accounts.$inferSelect) {
  if (account.planId === "trial" || !account.planExpiresAt) return false;
  const expiresAt = new Date(account.planExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function accountSummary(account: typeof accounts.$inferSelect, brandCount = 0) {
  const rule = planRule(account.planId);
  const expired = isPaidPlanExpired(account);
  const createdAtMs = new Date(account.createdAt).getTime();
  return {
    planId: rule.id,
    planName: expired ? `${rule.name} — срок истёк` : rule.name,
    generationsUsed: account.generationsUsed,
    generationLimit: expired ? 0 : rule.generationLimit,
    generationsRemaining: expired ? 0 : Math.max(0, rule.generationLimit - account.generationsUsed),
    researchUsed: account.researchUsed,
    researchLimit: expired ? 0 : rule.researchLimit,
    researchRemaining: expired ? 0 : Math.max(0, rule.researchLimit - account.researchUsed),
    editorActionsUsed: account.editorActionsUsed,
    editorActionLimit: expired ? 0 : rule.editorActionLimit,
    editorActionsRemaining: expired ? 0 : Math.max(0, rule.editorActionLimit - account.editorActionsUsed),
    // Lifetime totals for the "Ваша статистика" bar — never reset by the
    // monthly rollover in ensureAccount(), unlike the period counters
    // above (which still drive the plan quota widgets on /account and
    // the sidebar).
    lifetimeGenerationsUsed: account.lifetimeGenerationsUsed,
    lifetimeResearchUsed: account.lifetimeResearchUsed,
    lifetimeEditorActionsUsed: account.lifetimeEditorActionsUsed,
    daysWithKlio: Number.isNaN(createdAtMs) ? 0 : Math.max(0, Math.floor((Date.now() - createdAtMs) / 86400000)),
    brandCount,
    brandLimit: rule.brandLimit,
    seatLimit: rule.seatLimit,
    period: account.generationMonth,
    // Set only for accounts whose quota reset is anchored to a real
    // payment date (see quotaPeriodElapsed) — null for the trial plan and
    // for paid plans an admin granted by hand, which still reset on the
    // calendar month instead.
    quotaResetsAt: account.quotaPeriodEndsAt,
    // Null for the trial plan (see assertTrialActive for its own 48h
    // window) and for paid plans an admin granted without an expiry —
    // the account page flags that "missing" case too, same as /admin.
    planExpiresAt: account.planExpiresAt,
    planExpiryState: planExpiryState(rule.id, account.planExpiresAt),
  };
}

async function currentBrandCount(email: string) {
  const db = await getWorkspaceDb();
  const [{ count = 0 } = { count: 0 }] = await db.select({ count: sql<number>`count(*)` }).from(brands).where(eq(brands.ownerEmail, email));
  return Number(count);
}

// New accounts start on the "trial" plan (see ensureAccount) with a fixed
// 48h window rather than a monthly reset — once it elapses, every
// AI-costing action is blocked outright (see assertTrialActive) regardless
// of how much of the trial's own generationLimit/researchLimit/
// editorActionLimit was actually used.
const TRIAL_DURATION_MS = 48 * 60 * 60 * 1000;

function assertTrialActive(account: typeof accounts.$inferSelect) {
  if (account.planId !== "trial") return;
  const startedAt = new Date(account.createdAt).getTime();
  if (Number.isNaN(startedAt) || Date.now() - startedAt <= TRIAL_DURATION_MS) return;
  throw new WorkspaceAccessError(
    "Пробный период КЛИО закончился. Напишите нам, чтобы продолжить работу.",
    402,
  );
}

function assertPlanActive(account: typeof accounts.$inferSelect) {
  assertTrialActive(account);
  if (isPaidPlanExpired(account)) {
    throw new WorkspaceAccessError(
      "Срок оплаченного тарифа закончился. Материалы доступны для просмотра, но генерация отключена. Продлите тариф, чтобы продолжить работу.",
      402,
    );
  }
}

async function consumeSecondaryQuota(kind: "research" | "editor") {
  if (!await workspaceDatabaseAvailable()) return null;
  const user = await workspaceIdentity();
  const db = await getWorkspaceDb();
  const current = await ensureAccount(user);
  assertPlanActive(current);
  const rule = planRule(current.planId);

  const [updated] = kind === "research"
    ? await db.update(accounts).set({
      researchUsed: sql`${accounts.researchUsed} + 1`,
      lifetimeResearchUsed: sql`${accounts.lifetimeResearchUsed} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(accounts.email, user.email),
      lt(accounts.researchUsed, rule.researchLimit),
    )).returning()
    : await db.update(accounts).set({
      editorActionsUsed: sql`${accounts.editorActionsUsed} + 1`,
      lifetimeEditorActionsUsed: sql`${accounts.lifetimeEditorActionsUsed} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(accounts.email, user.email),
      lt(accounts.editorActionsUsed, rule.editorActionLimit),
    )).returning();

  if (!updated) {
    const label = kind === "research" ? "исследований" : "редакторских действий";
    const limit = kind === "research" ? rule.researchLimit : rule.editorActionLimit;
    throw new WorkspaceAccessError(`Лимит тарифа «${rule.name}» исчерпан: ${limit} ${label} ${rule.periodLabel}.`, 429);
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
  assertPlanActive(current);
  const rule = planRule(current.planId);
  if (current.generationsUsed >= rule.generationLimit) {
    throw new WorkspaceAccessError(`Лимит тарифа «${rule.name}» исчерпан: ${rule.generationLimit} материалов ${rule.periodLabel}.`, 429);
  }
}

export async function assertSecondaryQuotaAvailable(kind: "research" | "editor") {
  if (!await workspaceDatabaseAvailable()) return;
  const user = await workspaceIdentity();
  const current = await ensureAccount(user);
  assertPlanActive(current);
  const rule = planRule(current.planId);
  const used = kind === "research" ? current.researchUsed : current.editorActionsUsed;
  const limit = kind === "research" ? rule.researchLimit : rule.editorActionLimit;
  if (used >= limit) {
    const label = kind === "research" ? "исследований" : "редакторских действий";
    throw new WorkspaceAccessError(`Лимит тарифа «${rule.name}» исчерпан: ${limit} ${label} ${rule.periodLabel}.`, 429);
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
  assertPlanActive(current);
  const rule = planRule(current.planId);
  const [updated] = await db.update(accounts).set({
    generationsUsed: sql`${accounts.generationsUsed} + 1`,
    lifetimeGenerationsUsed: sql`${accounts.lifetimeGenerationsUsed} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(and(
    eq(accounts.email, user.email),
    lt(accounts.generationsUsed, rule.generationLimit),
  )).returning();

  if (!updated) {
    throw new WorkspaceAccessError(`Лимит тарифа «${rule.name}» исчерпан: ${rule.generationLimit} материалов ${rule.periodLabel}.`, 429);
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
  // Do not log the complete database connection error: postgres may include
  // DATABASE_URL (including its password) in the error object.
  console.error("Workspace persistence failed", error instanceof Error ? error.message : "unknown error");
  return Response.json({ error: "Не удалось сохранить данные кабинета." }, { status: 500 });
}
