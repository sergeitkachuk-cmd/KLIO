import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { accounts, brands, generations, asyncJobs } from "../../../db/schema";
import { getDb } from "../../../db";
import type { ChatGPTUser } from "../../chatgpt-auth";
import { getCurrentUser } from "../../identity";
import { planRule, planExpiryState } from "../../plans";
import { nextQuotaPeriodEnd } from "./subscription";
import { launchDiscountWindowOpen } from "../../billing-pricing";

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
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    return { displayName: "Сергей", email: "preview@klio.local", fullName: "Сергей" };
  }
  throw new WorkspaceAccessError("Войдите в КЛИО, чтобы открыть личный кабинет.", 401);
}

function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// True once the current usage-quota period (generationsUsed/researchUsed/
// editorActionsUsed) needs zeroing again. Accounts that went through a real
// payment carry quotaPeriodEndsAt, anchored to the payment date — any paid
// plan an admin granted by hand without one falls back to the legacy plain
// calendar-month comparison instead. The trial plan never reaches this at
// all: it isn't a recurring period, it's a single 48h window (see
// isTrialExpired/assertTrialActive) — without this guard, a trial account
// that's sat expired for weeks would have its counters silently zeroed back
// to "fresh" on the next visit after a month boundary, while still being
// hard-blocked by assertTrialActive underneath. Found 2026-09-03: an
// account created 2026-08-13 (long past its 48h window) still showed full
// quota on /account after the calendar flipped to September.
function quotaPeriodElapsed(account: typeof accounts.$inferSelect, now: Date) {
  if (account.planId === "trial") return false;
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

// signupMethod only matters the first time this creates a row (the insert
// branch below) — every other call site either passes nothing (an internal
// "make sure this already-logged-in user's row exists" check, e.g. billing/
// publications) or is re-fetching an existing account, where the argument
// is simply ignored. Defaults to "email" so an unrelated call site that
// never specifies it still writes a real, schema-valid value rather than
// relying on the column's own "unknown" default (that default exists for
// rows that predate this field, not for new ones).
export async function ensureAccount(user: ChatGPTUser, signupMethod: "email" | "yandex" | "vk" = "email") {
  const db = await getWorkspaceDb();
  const now = new Date();
  const currentMonth = monthKey(now);
  let [account] = await db.select().from(accounts).where(eq(accounts.email, user.email)).limit(1);

  if (!account) {
    [account] = await db.insert(accounts).values({
      email: user.email,
      displayName: user.displayName,
      workspaceMode: "dialogue",
      planId: isTestAccount(user.email) ? "agency" : "trial",
      signupMethod,
      generationMonth: currentMonth,
      generationsUsed: 0,
      researchUsed: 0,
      editorActionsUsed: 0,
      lifetimeGenerationsUsed: 0,
      lifetimeResearchUsed: 0,
      lifetimeEditorActionsUsed: 0,
    }).onConflictDoNothing({ target: accounts.email }).returning();
    if (!account) [account] = await db.select().from(accounts).where(eq(accounts.email, user.email)).limit(1);
  } else if (quotaPeriodElapsed(account, now)) {
    // Catch up in one reset. A compare-and-swap prevents a second request
    // from erasing usage recorded after the first request's rollover.
    let nextAnchor = account.quotaPeriodEndsAt;
    while (nextAnchor && new Date(nextAnchor).getTime() <= now.getTime()) {
      nextAnchor = nextQuotaPeriodEnd(new Date(nextAnchor));
    }
    const [rolledOver] = await db.update(accounts).set({
      displayName: user.displayName,
      generationMonth: currentMonth,
      quotaPeriodEndsAt: nextAnchor,
      generationsUsed: 0,
      researchUsed: 0,
      editorActionsUsed: 0,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(accounts.email, user.email),
      eq(accounts.generationMonth, account.generationMonth),
      account.quotaPeriodEndsAt ? eq(accounts.quotaPeriodEndsAt, account.quotaPeriodEndsAt) : isNull(accounts.quotaPeriodEndsAt),
    )).returning();
    if (rolledOver) account = rolledOver;
    else [account] = await db.select().from(accounts).where(eq(accounts.email, user.email)).limit(1);
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

// New accounts start on the "trial" plan (see ensureAccount) with a fixed
// 48h window rather than a monthly reset — once it elapses, every
// AI-costing action is blocked outright (see assertTrialActive) regardless
// of how much of the trial's own generationLimit/researchLimit/
// editorActionLimit was actually used. Shared by accountSummary (so
// /account actually shows this instead of silently hiding it) and
// assertTrialActive (the real enforcement) so the two can't drift apart.
export const TRIAL_DURATION_MS = 48 * 60 * 60 * 1000;

function isTrialExpired(account: typeof accounts.$inferSelect) {
  if (account.planId !== "trial") return false;
  const startedAt = new Date(account.createdAt).getTime();
  return Number.isFinite(startedAt) && Date.now() - startedAt > TRIAL_DURATION_MS;
}

// Trial never had its own expiry timestamp before — assertTrialActive
// computed createdAt+48h inline and nothing else saw it, so neither /account
// nor /admin had anything to show while the trial was still running, nor any
// way to tell a fresh trial from a 3-week-old expired one. This is derived,
// not stored — the accounts table itself still has no trial expiry column,
// only createdAt — and is exported so /admin can display the same deadline
// instead of reading the raw (always-null-for-trial) planExpiresAt column.
export function trialExpiresAt(account: typeof accounts.$inferSelect): string | null {
  if (account.planId !== "trial") return null;
  const createdAtMs = new Date(account.createdAt).getTime();
  return Number.isFinite(createdAtMs) ? new Date(createdAtMs + TRIAL_DURATION_MS).toISOString() : null;
}

export function accountSummary(account: typeof accounts.$inferSelect, brandCount = 0) {
  const rule = planRule(account.planId);
  const expired = isPaidPlanExpired(account) || isTrialExpired(account);
  const createdAtMs = new Date(account.createdAt).getTime();
  // Feeding this synthetic deadline through the same planExpiresAt/
  // planExpiryState fields a paid plan uses means /account's existing expiry
  // line, day-banded coloring (soon/critical/expired) and countdown wording
  // all work for trial too, with no separate code path.
  const effectivePlanExpiresAt = account.planId === "trial" ? trialExpiresAt(account) : account.planExpiresAt;
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
    // The trial's own createdAt+48h deadline for trial accounts (see
    // trialExpiresAt above, also used directly by /admin); for paid plans,
    // the real payment/admin-granted expiry, or null if an admin granted one
    // without an expiry — the account page flags that "missing" case.
    planExpiresAt: effectivePlanExpiresAt,
    planExpiryState: planExpiryState(rule.id, effectivePlanExpiresAt),
    // Drives the launch-discount banner (workspace + /account) — false once
    // either the account has already used it or the launch window has
    // closed, so the banner disappears on its own without a dismiss button.
    launchDiscountAvailable: launchDiscountWindowOpen() && !account.launchDiscountUsedAt,
  };
}

function assertTrialActive(account: typeof accounts.$inferSelect) {
  if (!isTrialExpired(account)) return;
  throw new WorkspaceAccessError(
    "Пробный период КЛИО закончился. Выберите тариф, чтобы продолжить работу.",
    402,
  );
}

export function assertPlanActive(account: typeof accounts.$inferSelect) {
  assertTrialActive(account);
  if (isPaidPlanExpired(account)) {
    throw new WorkspaceAccessError(
      "Срок оплаченного тарифа закончился. Материалы доступны для просмотра, но генерация отключена. Продлите тариф, чтобы продолжить работу.",
      402,
    );
  }
}

type JobResult = { id: string; result: Record<string, unknown> };

async function consumeSecondaryQuota(kind: "research" | "editor", job?: JobResult) {
  if (!await workspaceDatabaseAvailable()) return null;
  const user = await workspaceIdentity();
  const db = await getWorkspaceDb();
  const current = await ensureAccount(user);
  assertPlanActive(current);
  const rule = planRule(current.planId);

  return db.transaction(async (tx) => {
  if (job) {
    const [active] = await tx.update(asyncJobs).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(
      eq(asyncJobs.id, job.id), eq(asyncJobs.ownerEmail, user.email), eq(asyncJobs.status, "processing"),
      eq(asyncJobs.kind, kind === "research" ? "content_plan" : "adapt_text"),
    )).returning({ id: asyncJobs.id });
    if (!active) throw new WorkspaceAccessError("Задание уже завершено или закрыто. Повторное сохранение не выполнено.", 409);
  }
  const [updated] = kind === "research"
    ? await tx.update(accounts).set({
      researchUsed: sql`${accounts.researchUsed} + 1`,
      lifetimeResearchUsed: sql`${accounts.lifetimeResearchUsed} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(
      eq(accounts.email, user.email),
      lt(accounts.researchUsed, rule.researchLimit),
    )).returning()
    : await tx.update(accounts).set({
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

  const [{ count: brandCount = 0 } = { count: 0 }] = await tx.select({ count: sql<number>`count(*)` }).from(brands).where(eq(brands.ownerEmail, user.email));
  const usage = { account: accountSummary(updated, Number(brandCount)) };
  if (job) await tx.update(asyncJobs).set({ status: "done", resultJson: JSON.stringify({ ...job.result, usage }), updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(asyncJobs.id, job.id), eq(asyncJobs.ownerEmail, user.email)));
  return usage;
  });
}

// Mirrors assertSecondaryQuotaAvailable but for the primary "generation"
// counter — called before the (costly) OpenAI request in /api/generate so
// an account that's already over its monthly limit doesn't still burn a
// real generation call only to have recordGeneration() reject it afterward.
export async function assertGenerationQuotaAvailable(brandId?: string) {
  if (!await workspaceDatabaseAvailable()) return;
  const user = await workspaceIdentity();
  const current = await ensureAccount(user);
  assertPlanActive(current);
  if (brandId) {
    const db = await getWorkspaceDb();
    const [brand] = await db.select({ id: brands.id }).from(brands).where(and(eq(brands.id, brandId), eq(brands.ownerEmail, user.email))).limit(1);
    if (!brand) throw new WorkspaceAccessError("Бренд не найден или недоступен.", 404);
  }
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

export async function recordResearch(job?: JobResult) {
  return consumeSecondaryQuota("research", job);
}

export async function recordEditorialAction(job?: JobResult) {
  return consumeSecondaryQuota("editor", job);
}

export type ArchiveMaterial = {
  id?: string;
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
  imageUrl?: string;
};

export async function recordGeneration(material: ArchiveMaterial, job?: { id: string; result: Record<string, unknown> }) {
  if (!await workspaceDatabaseAvailable()) return null;
  const user = await workspaceIdentity();
  const db = await getWorkspaceDb();
  const current = await ensureAccount(user);
  assertPlanActive(current);
  const rule = planRule(current.planId);
  return db.transaction(async (tx) => {
  if (job) {
    // Lock the still-active owned task before any quota debit or archive
    // insert. Expiration and another completion contend on this same row.
    const [active] = await tx.update(asyncJobs).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(
      eq(asyncJobs.id, job.id), eq(asyncJobs.ownerEmail, user.email), eq(asyncJobs.status, "processing"),
    )).returning({ id: asyncJobs.id });
    if (!active) throw new WorkspaceAccessError("Задание уже завершено или закрыто. Повторное сохранение не выполнено.", 409);
  }
  const [updated] = await tx.update(accounts).set({
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
    const [ownedBrand] = await tx.select({ id: brands.id }).from(brands).where(and(
      eq(brands.id, material.brandId),
      eq(brands.ownerEmail, user.email),
    )).limit(1);
    if (!ownedBrand) throw new WorkspaceAccessError("Бренд не найден или недоступен.", 404);
    brandId = ownedBrand.id;
  }

  const [archive] = await tx.insert(generations).values({
    id: material.id ?? crypto.randomUUID(),
    ownerEmail: user.email,
    brandId,
    format: material.format,
    origin: "generator",
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
    imageUrl: material.imageUrl ?? "",
  }).returning();

  const [{ count: brandCount = 0 } = { count: 0 }] = await tx.select({ count: sql<number>`count(*)` }).from(brands).where(eq(brands.ownerEmail, user.email));
  const usage = { account: accountSummary(updated, Number(brandCount)), archive };
  if (job) await tx.update(asyncJobs).set({ status: "done", resultJson: JSON.stringify({ ...job.result, usage }), updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(asyncJobs.id, job.id), eq(asyncJobs.ownerEmail, user.email)));
  return usage;
  });
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
  console.error("Workspace persistence failed");
  return Response.json({ error: "Не удалось сохранить данные кабинета." }, { status: 500 });
}
