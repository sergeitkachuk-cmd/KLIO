import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "../identity";
import { isAdminEmail } from "../api/_lib/admin";
import type { AiOperation } from "../api/_lib/ai-config";
import { getDb } from "../../db";
import { accounts, aiUsage, announcements, asyncJobs, brands, emailVerifications, feedbackMessages, generations, invoices, materials, passwordResets, payments, publications, sessions, socialChannels } from "../../db/schema";
import { planRule, planExpiryState, formatPlanExpiry } from "../plans";
import { billingDescription, type BillingPeriod } from "../billing-pricing";
import { getExternalServiceStatuses } from "../api/_lib/external-service-status";
import { trialExpiresAt } from "../api/_lib/workspace-account";
import { AdminThemeToggle } from "./admin-theme-toggle";
import { AdminAccountControls } from "./admin-account-controls";
import { AdminUsersTable, type AdminUserRow } from "./admin-users-table";
import { AdminFeedbackTable } from "./admin-feedback-table";
import { AdminAnnouncements } from "./admin-announcements";
import { AdminShell, type AdminSection } from "./admin-shell";

export const metadata = { title: "КЛИО / Админка" };

// Owner-only usage/spend dashboard — never linked from the visitor-facing
// UI. Reads accounts + ai_usage (see app/api/_lib/ai-router.ts) directly;
// no client JS, no separate API route, so there's nothing here for a
// non-admin session to even fetch.
function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

// This page is a server component, rendered in the host's own timezone —
// Timeweb (like most containers) runs UTC, not Moscow, so every timestamp
// here was silently 3 hours behind reality until this was pinned explicitly.
// (Client components — e.g. invoice-documents.tsx — don't need this: they
// format in the viewer's own browser timezone already.)
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatNumber(value: number): string {
  return value.toLocaleString("ru-RU");
}

// Mirrors BrandProfile in app/textora-experience.tsx (kept as a plain
// duplicate list rather than a shared import — see the SeoAuditReport
// mirror comment there for why this file has no existing pattern of
// importing client-side types). Site owner asked for "насколько процентов
// заполнен профиль бренда" instead of just a brand count — this is that
// percentage: how many of the profile's real content fields are non-empty,
// not just whether a brand row exists at all.
const BRAND_PROFILE_FIELDS = ["name", "website", "description", "positioning", "audience", "advantages", "products", "services", "proof", "geography", "vocabulary", "cta", "voice", "restrictions", "signature", "prohibited"] as const;

function brandProfileCompletion(profileJson: string): number {
  try {
    const parsed = JSON.parse(profileJson) as Record<string, unknown>;
    let filled = 0;
    for (const field of BRAND_PROFILE_FIELDS) {
      const value = parsed[field];
      if (typeof value === "string" && value.trim()) filled += 1;
    }
    return Math.round((filled / BRAND_PROFILE_FIELDS.length) * 100);
  } catch {
    return 0;
  }
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
}

// Calendar-day comparison in Moscow time (see formatDate's own comment on
// why — the host runs UTC), not a rolling 24h window: someone who signed up
// at 23:50 Moscow time reads as "today" only until midnight, same as a
// human would judge it, not for a full day afterward.
function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const asMoscowDate = (input: Date) => input.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
  return asMoscowDate(date) === asMoscowDate(new Date());
}

function formatDuration(value: unknown): string {
  const milliseconds = num(value);
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} мс`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} с`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes} мин ${remainder} с`;
}

// Typed against AiOperation so adding a new operation to ai-config.ts
// without a matching label here is a compile error, not a silent
// snake_case fallback in the table.
const OPERATION_LABELS: Record<AiOperation, string> = {
  generate_seo_article: "Генерация: SEO-статья",
  generate_social_post: "Генерация: соцсети",
  generate_ad_copy: "Генерация: реклама",
  generate_landing: "Генерация: сайт",
  generate_quick_material: "Быстрый ввод",
  adapt_text: "Редактор адаптации",
  generate_content_plan: "Контент-план",
  revise_content_plan: "Контент-план: замена тем",
  research_semantics: "Семантика",
  discover_competitors: "Поиск конкурентов",
  analyze_competitors: "Матрица конкурентов",
  revise_content: "Коррекция черновика",
  analyze_brand_website: "Анализ сайта бренда",
  suggest_brand_voice: "Подбор голоса бренда",
  infer_content_plan_industry: "Контент-план: поиск отрасли (nano)",
  normalize_quick_brief: "Разбор брифа (nano)",
  validate_content: "Проверка качества (nano)",
  condense_overflow: "Сжатие переполнения (nano)",
};

// payments.status values written by /api/payments/tochka/create (pending)
// and the webhook handler (paid) — refunded is set manually today, there is
// no automated refund flow yet.
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает оплаты",
  paid: "Оплачен",
  refunded: "Возвращён",
};

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?return_to=%2Fadmin");
  if (!isAdminEmail(user.email)) redirect("/workspace");

  if (!process.env.DATABASE_URL?.trim()) {
    return (
      <main className="admin-page">
        <AdminStyles />
        <p className="admin-empty">База данных не подключена — админка недоступна.</p>
      </main>
    );
  }

  const db = getDb();

  // Unverified sign-ups are only registration attempts. Remove stale ones so
  // typos do not accumulate as permanent customer rows.
  const staleAccounts = await db.select({ email: accounts.email }).from(accounts).where(and(
    eq(accounts.emailVerified, false),
    sql`${accounts.createdAt}::timestamptz < now() - interval '48 hours'`,
  ));
  for (const stale of staleAccounts) {
    await db.delete(payments).where(eq(payments.ownerEmail, stale.email));
    await db.delete(invoices).where(eq(invoices.ownerEmail, stale.email));
    await db.delete(sessions).where(eq(sessions.email, stale.email));
    await db.delete(emailVerifications).where(eq(emailVerifications.email, stale.email));
    await db.delete(passwordResets).where(eq(passwordResets.email, stale.email));
    await db.delete(brands).where(eq(brands.ownerEmail, stale.email));
    await db.delete(generations).where(eq(generations.ownerEmail, stale.email));
    await db.delete(materials).where(eq(materials.ownerEmail, stale.email));
    await db.delete(aiUsage).where(eq(aiUsage.ownerEmail, stale.email));
    await db.delete(asyncJobs).where(eq(asyncJobs.ownerEmail, stale.email));
    await db.delete(accounts).where(eq(accounts.email, stale.email));
  }

  const [userRows, usageByUser, brandRows, invoiceRefsByUser, transactionRefsByUser, totalsRows, last30Rows, byModelRows, byOperationRows, recentAiRows, externalServices, paymentRows, generationsByOriginRows, materialsByTypeRows, publicationsByOwnerRows, paidPaymentOwners, paidInvoiceOwners, socialChannelsByOwnerRows] = await Promise.all([
    db.select().from(accounts).orderBy(desc(accounts.createdAt)),
    db.select({
      ownerEmail: aiUsage.ownerEmail,
      totalCostUsd: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)`,
      totalCalls: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)`,
      lastCallAt: sql<string>`max(${aiUsage.createdAt})`,
    }).from(aiUsage).groupBy(aiUsage.ownerEmail),
    // Full profileJson per brand (not just a count) — needed for the
    // "% заполнен профиль бренда" breakdown below. brandMap (count) and
    // brandProfileMap (completion of the most recently updated brand) are
    // both derived from this single fetch in JS instead of two queries.
    db.select({
      id: brands.id,
      ownerEmail: brands.ownerEmail,
      profileJson: brands.profileJson,
      updatedAt: brands.updatedAt,
    }).from(brands),
    db.select({
      ownerEmail: invoices.ownerEmail,
      invoiceRefs: sql<string>`coalesce(string_agg(distinct ${invoices.tochkaDocumentId}, ', '), '')`,
      payerNames: sql<string>`coalesce(string_agg(distinct ${invoices.buyerName}, ', '), '')`,
    }).from(invoices).groupBy(invoices.ownerEmail),
    db.select({
      ownerEmail: payments.ownerEmail,
      transactionRefs: sql<string>`coalesce(string_agg(distinct coalesce(${payments.operationId}, ${payments.id}), ', '), '')`,
    }).from(payments).groupBy(payments.ownerEmail),
    db.select({
      totalCostUsd: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)`,
      totalCalls: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)`,
    }).from(aiUsage),
    db.select({
      totalCostUsd: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)`,
      totalCalls: sql<number>`count(*)`,
    }).from(aiUsage).where(sql`${aiUsage.createdAt}::timestamptz > now() - interval '30 days'`),
    db.select({
      model: aiUsage.model,
      totalCostUsd: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)`,
      totalCalls: sql<number>`count(*)`,
    }).from(aiUsage).groupBy(aiUsage.model),
    db.select({
      operation: aiUsage.operation,
      totalCostUsd: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)`,
      totalCalls: sql<number>`count(*)`,
      averageDurationMs: sql<number>`coalesce(avg(${aiUsage.durationMs}), 0)`,
      maximumDurationMs: sql<number>`coalesce(max(${aiUsage.durationMs}), 0)`,
    }).from(aiUsage).groupBy(aiUsage.operation).orderBy(sql`sum(${aiUsage.estimatedCostUsd}) desc`),
    db.select({
      id: aiUsage.id,
      ownerEmail: aiUsage.ownerEmail,
      operation: aiUsage.operation,
      model: aiUsage.model,
      reasoningEffort: aiUsage.reasoningEffort,
      durationMs: aiUsage.durationMs,
      inputTokens: aiUsage.inputTokens,
      outputTokens: aiUsage.outputTokens,
      retryCount: aiUsage.retryCount,
      status: aiUsage.status,
      errorMessage: aiUsage.errorMessage,
      createdAt: aiUsage.createdAt,
    }).from(aiUsage).orderBy(desc(aiUsage.createdAt)).limit(30),
    getExternalServiceStatuses(),
    // Raw payment attempts (SBP/card quick-pay, not the invoice/УПД flow) —
    // exists so a stuck payment (webhook never arrived, see the delivery
    // outage around commit 160b7e6) can be found and cross-checked against
    // Tochka's own dashboard by its id/operationId instead of guessing from
    // the rolled-up "Операции" field on the users table.
    db.select().from(payments).orderBy(desc(payments.createdAt)).limit(200),
    // Breaks the old single "Генерации" count into what it's actually made
    // of — origin distinguishes a generator-written text from an edited one
    // from a manual entry pasted into the Публикации calendar (site owner:
    // "сколько создано текстов, сколько редакторских... чтобы это было не
    // общее обозначение").
    db.select({
      ownerEmail: generations.ownerEmail,
      origin: generations.origin,
      count: sql<number>`count(*)`,
    }).from(generations).groupBy(generations.ownerEmail, generations.origin),
    // materials.type is "content_plan" | "semantics" | "competitors" (see
    // SavedMaterialType in app/textora-experience.tsx) — the other half of
    // "сколько контент-плана" etc.
    db.select({
      ownerEmail: materials.ownerEmail,
      type: materials.type,
      count: sql<number>`count(*)`,
    }).from(materials).groupBy(materials.ownerEmail, materials.type),
    db.select({
      ownerEmail: publications.ownerEmail,
      count: sql<number>`count(*)`,
    }).from(publications).groupBy(publications.ownerEmail),
    // "Ever paid" for the funnel below — checked separately from the
    // account's current planId, since a lapsed/expired paid plan falls
    // back to "trial" but the account genuinely did convert once.
    db.select({ ownerEmail: payments.ownerEmail }).from(payments).where(eq(payments.status, "paid")).groupBy(payments.ownerEmail),
    db.select({ ownerEmail: invoices.ownerEmail }).from(invoices).where(eq(invoices.paymentStatus, "payment_paid")).groupBy(invoices.ownerEmail),
    // "Сколько человек и сколько подключило каналов соцсетей" — one brand
    // can hold several channels (see the schema comment on socialChannels:
    // a main + regional community, VK alongside Telegram, ...), so this is
    // grouped by owner+platform, not just counted, to answer both "how many
    // people" (distinct owners below) and "which platform" at once.
    db.select({
      ownerEmail: socialChannels.ownerEmail,
      platform: socialChannels.platform,
      count: sql<number>`count(*)`,
    }).from(socialChannels).groupBy(socialChannels.ownerEmail, socialChannels.platform),
  ]);

  const usageMap = new Map(usageByUser.map((row) => [row.ownerEmail, row]));
  const brandMap = new Map<string, number>();
  const brandLatestByOwner = new Map<string, { updatedAt: string; profileJson: string }>();
  for (const brand of brandRows) {
    brandMap.set(brand.ownerEmail, (brandMap.get(brand.ownerEmail) ?? 0) + 1);
    const existing = brandLatestByOwner.get(brand.ownerEmail);
    if (!existing || brand.updatedAt > existing.updatedAt) brandLatestByOwner.set(brand.ownerEmail, brand);
  }
  const brandProfileMap = new Map<string, number>();
  for (const [ownerEmail, brand] of brandLatestByOwner) brandProfileMap.set(ownerEmail, brandProfileCompletion(brand.profileJson));
  const generationsByOwner = new Map<string, { generator: number; editor: number; manual: number }>();
  for (const row of generationsByOriginRows) {
    const entry = generationsByOwner.get(row.ownerEmail) ?? { generator: 0, editor: 0, manual: 0 };
    if (row.origin === "generator") entry.generator += num(row.count);
    else if (row.origin === "editor") entry.editor += num(row.count);
    else if (row.origin === "manual") entry.manual += num(row.count);
    generationsByOwner.set(row.ownerEmail, entry);
  }
  const materialsByOwner = new Map<string, { contentPlan: number; semantics: number; competitors: number }>();
  for (const row of materialsByTypeRows) {
    const entry = materialsByOwner.get(row.ownerEmail) ?? { contentPlan: 0, semantics: 0, competitors: 0 };
    if (row.type === "content_plan") entry.contentPlan += num(row.count);
    else if (row.type === "semantics") entry.semantics += num(row.count);
    else if (row.type === "competitors") entry.competitors += num(row.count);
    materialsByOwner.set(row.ownerEmail, entry);
  }
  const publicationsMap = new Map(publicationsByOwnerRows.map((row) => [row.ownerEmail, num(row.count)]));
  const paidOwners = new Set([...paidPaymentOwners.map((row) => row.ownerEmail), ...paidInvoiceOwners.map((row) => row.ownerEmail)]);
  const socialChannelsByOwner = new Map<string, { vk: number; telegram: number }>();
  for (const row of socialChannelsByOwnerRows) {
    const entry = socialChannelsByOwner.get(row.ownerEmail) ?? { vk: 0, telegram: 0 };
    if (row.platform === "vk") entry.vk += num(row.count);
    else if (row.platform === "telegram") entry.telegram += num(row.count);
    socialChannelsByOwner.set(row.ownerEmail, entry);
  }
  const invoiceMap = new Map(invoiceRefsByUser.map((row) => [row.ownerEmail, row]));
  const transactionMap = new Map(transactionRefsByUser.map((row) => [row.ownerEmail, row.transactionRefs]));

  const users = userRows.map((account) => {
    const plan = planRule(account.planId);
    const usage = usageMap.get(account.email);
    const gen = generationsByOwner.get(account.email) ?? { generator: 0, editor: 0, manual: 0 };
    const mat = materialsByOwner.get(account.email) ?? { contentPlan: 0, semantics: 0, competitors: 0 };
    const social = socialChannelsByOwner.get(account.email) ?? { vk: 0, telegram: 0 };
    const modulesUsed = [gen.generator > 0, gen.editor > 0, mat.contentPlan > 0, mat.semantics > 0, mat.competitors > 0].filter(Boolean).length;
    return {
      email: account.email,
      displayName: account.displayName,
      emailVerified: account.emailVerified,
      signupMethod: account.signupMethod,
      registeredToday: isToday(account.createdAt),
      createdAt: account.createdAt,
      planName: plan.name,
      planId: account.planId,
      // Raw column is always null for "trial" (see the schema comment on
      // accounts.planExpiresAt) — trialExpiresAt derives the real createdAt+48h
      // deadline so the admin table shows an actual date/countdown instead of
      // the bare "Пробный период" label formatPlanExpiry falls back to.
      planExpiresAt: account.planId === "trial" ? trialExpiresAt(account) : account.planExpiresAt,
      generationsUsed: account.generationsUsed,
      generationLimit: plan.generationLimit,
      researchUsed: account.researchUsed,
      researchLimit: plan.researchLimit,
      editorActionsUsed: account.editorActionsUsed,
      editorActionLimit: plan.editorActionLimit,
      brandCount: brandMap.get(account.email) ?? 0,
      brandProfileCompletion: brandProfileMap.get(account.email) ?? null,
      textsGenerated: gen.generator,
      textsEdited: gen.editor,
      textsManual: gen.manual,
      contentPlans: mat.contentPlan,
      semanticsRuns: mat.semantics,
      competitorAnalyses: mat.competitors,
      publicationsCount: publicationsMap.get(account.email) ?? 0,
      socialChannelsVk: social.vk,
      socialChannelsTelegram: social.telegram,
      socialChannelsConnected: social.vk + social.telegram,
      modulesUsed,
      everPaid: paidOwners.has(account.email),
      totalCostUsd: num(usage?.totalCostUsd),
      totalCalls: num(usage?.totalCalls),
      totalTokens: num(usage?.totalTokens),
      lastCallAt: usage?.lastCallAt ?? null,
      invoiceRefs: invoiceMap.get(account.email)?.invoiceRefs ?? "",
      payerNames: invoiceMap.get(account.email)?.payerNames ?? "",
      transactionRefs: transactionMap.get(account.email) ?? "",
    };
  });
  const activeUsers = users.filter((item) => item.emailVerified);
  const pendingUsers = users.filter((item) => !item.emailVerified);

  // "Задать вопрос" submissions (see app/api/feedback/route.ts) — a
  // separate query rather than folded into the big Promise.all above since
  // it's not part of the per-user usage rollup, just its own small list.
  const feedbackRows = await db.select().from(feedbackMessages).orderBy(desc(feedbackMessages.createdAt)).limit(200);
  // Admin-authored messages to clients (see app/api/admin/announcements/
  // route.ts) — the opposite direction of feedbackRows above.
  const announcementRows = await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(200);

  const totals = totalsRows[0] ?? { totalCostUsd: 0, totalCalls: 0, totalTokens: 0 };
  const last30 = last30Rows[0] ?? { totalCostUsd: 0, totalCalls: 0 };
  const verifiedCount = users.filter((item) => item.emailVerified).length;

  // Activation/retention funnel — "чтобы понимать и делать анализ по
  // подписчикам, что заходит, а что нет, на каких этапах отваливаются".
  // Every stage is derived from data already collected for other reasons
  // (no new tracking/instrumentation needed): a real account never reaches
  // "оплатили тариф" without genuinely converting, "создали первый
  // материал" is any of the six content-producing actions across
  // generations/materials, and "активны за 30 дней" reuses the same
  // aiUsage.lastCallAt already shown per user. Kept as plain current-state
  // counts (not a time-boxed cohort) for this first version — a "signups
  // from October reached stage X by November" cohort view is a natural
  // next step once this is useful enough to want that precision.
  const funnelStages = [
    { id: "registered", label: "Зарегистрировались", count: users.length },
    { id: "verified", label: "Подтвердили почту", count: verifiedCount },
    { id: "brand", label: "Создали профиль бренда", count: users.filter((item) => item.brandCount > 0).length },
    { id: "brand-filled", label: "Заполнили профиль бренда ≥50%", count: users.filter((item) => (item.brandProfileCompletion ?? 0) >= 50).length },
    { id: "first-material", label: "Создали первый материал", count: users.filter((item) => item.textsGenerated + item.textsEdited + item.textsManual + item.contentPlans + item.semanticsRuns + item.competitorAnalyses > 0).length },
    { id: "multi-module", label: "Использовали 2+ инструмента", count: users.filter((item) => item.modulesUsed >= 2).length },
    { id: "paid", label: "Оплатили тариф", count: users.filter((item) => item.everPaid).length },
    { id: "active-30d", label: "Активны за последние 30 дней", count: users.filter((item) => { const days = daysSince(item.lastCallAt); return days !== null && days <= 30; }).length },
  ];

  // "Добавить методы регистрации на сайте: по электронке, через яндекс или
  // вк, чтобы понимать что удобно людям" — accounts.signupMethod is set once
  // at creation (see ensureAccount in workspace-account.ts); "unknown" is
  // only ever a real, pre-migration account, never a new one.
  const SIGNUP_METHOD_LABELS: Record<string, string> = { email: "Email", yandex: "Яндекс", vk: "VK", unknown: "Неизвестно (до внедрения учёта)" };
  const signupMethodCounts = new Map<string, number>();
  for (const item of users) signupMethodCounts.set(item.signupMethod, (signupMethodCounts.get(item.signupMethod) ?? 0) + 1);
  const signupMethodBreakdown = [...signupMethodCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([method, count]) => ({ method, label: SIGNUP_METHOD_LABELS[method] ?? method, count }));

  // "Сколько человек и сколько подключило каналов соцсетей" — connected-at-
  // least-one is the activation signal (funnel-style, % of all accounts);
  // the vk/telegram split below it is about which platform to prioritize.
  const socialChannelsConnectedCount = users.filter((item) => item.socialChannelsConnected > 0).length;
  const socialChannelsBreakdown = [
    { id: "vk", label: "VK", count: users.filter((item) => item.socialChannelsVk > 0).length },
    { id: "telegram", label: "Telegram", count: users.filter((item) => item.socialChannelsTelegram > 0).length },
  ];

  // One section per former top-to-bottom block, now shown one at a time
  // behind the sidebar (see AdminShell) instead of all stacked on one
  // page - "Пользователи" and "Последние вызовы ИИ" alone used to push
  // "Платежи" several screens down. Order matches the original page order
  // so nothing moves for anyone used to scrolling to find it, just tabs
  // instead of scroll position now. "Ожидают подтверждения" is appended
  // below, only when there's something in it, same as before.
  const sections: AdminSection[] = [];
  sections.push({
    id: "services",
    label: "Внешние сервисы",
    content: (
      <section className="admin-block admin-integrations-block">
        <div className="admin-block-heading">
          <div>
            <h2>Внешние сервисы</h2>
            <p>Данные запрашиваются заново при открытии этой страницы. Ключи и токены остаются только на сервере.</p>
          </div>
          <a className="admin-refresh" href="/admin">Обновить</a>
        </div>
        <div className="admin-integrations">
          {externalServices.map((service) => (
            <article className={`admin-integration admin-integration-${service.state}`} key={service.id}>
              <div className="admin-integration-top">
                <span>{service.name}</span>
                <i>{service.state === "connected" ? "Подключён" : service.state === "needs_setup" ? "Нужна настройка" : "Нет ответа"}</i>
              </div>
              <b>{service.primary}</b>
              <small>{service.detail}</small>
              <a href={service.href} target="_blank" rel="noreferrer">Открыть кабинет ↗</a>
            </article>
          ))}
        </div>
      </section>
    ),
  });
  sections.push({
    id: "spend-model",
    label: "Расход по модели",
    badge: String(byModelRows.length),
    content: (
      <section className="admin-block">
        <h2>Расход по модели</h2>
        <table className="admin-table">
          <thead><tr><th>Модель</th><th>Запросов</th><th>Расход</th></tr></thead>
          <tbody>
            {byModelRows.map((row) => (
              <tr key={row.model}>
                <td>{row.model}</td>
                <td>{formatNumber(num(row.totalCalls))}</td>
                <td>{formatUsd(num(row.totalCostUsd))}</td>
              </tr>
            ))}
            {!byModelRows.length && <tr><td colSpan={3} className="admin-empty-row">Пока нет вызовов ИИ.</td></tr>}
          </tbody>
        </table>
      </section>
    ),
  });
  sections.push({
    id: "spend-operation",
    label: "Расход по операциям",
    badge: String(byOperationRows.length),
    content: (
      <section className="admin-block">
        <h2>Расход по операциям</h2>
        <table className="admin-table">
          <thead><tr><th>Операция</th><th>Запросов</th><th>Среднее время</th><th>Максимум</th><th>Расход</th></tr></thead>
          <tbody>
            {byOperationRows.map((row) => (
              <tr key={row.operation}>
                <td>{OPERATION_LABELS[row.operation as AiOperation] ?? row.operation}</td>
                <td>{formatNumber(num(row.totalCalls))}</td>
                <td>{formatDuration(row.averageDurationMs)}</td>
                <td>{formatDuration(row.maximumDurationMs)}</td>
                <td>{formatUsd(num(row.totalCostUsd))}</td>
              </tr>
            ))}
            {!byOperationRows.length && <tr><td colSpan={5} className="admin-empty-row">Пока нет вызовов ИИ.</td></tr>}
          </tbody>
        </table>
      </section>
    ),
  });
  sections.push({
    id: "recent-calls",
    label: "Последние вызовы ИИ",
    badge: String(recentAiRows.length),
    content: (
      <section className="admin-block">
        <div className="admin-block-heading">
          <div>
            <h2>Последние вызовы ИИ</h2>
            <p>Каждая строка — отдельный запрос к модели. Несколько соседних строк одного пользователя могут относиться к одной генерации: основной текст, коррекция или сокращение.</p>
          </div>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>Время</th><th>Пользователь</th><th>Операция</th><th>Модель</th><th>Размышление</th><th>Длительность</th><th>Токены вход / выход</th><th>Статус</th><th>Ошибка</th></tr></thead>
            <tbody>
              {recentAiRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>{row.ownerEmail}</td>
                  <td>{OPERATION_LABELS[row.operation as AiOperation] ?? row.operation}</td>
                  <td>{row.model}</td>
                  <td>{row.reasoningEffort}</td>
                  <td>{formatDuration(row.durationMs)}</td>
                  <td>{formatNumber(row.inputTokens)} / {formatNumber(row.outputTokens)}</td>
                  <td>{row.status === "success" ? "Успешно" : `Ошибка${row.retryCount ? ` · повторов ${row.retryCount}` : ""}`}</td>
                  <td className="admin-ai-error">{row.errorMessage || "—"}</td>
                </tr>
              ))}
              {!recentAiRows.length && <tr><td colSpan={9} className="admin-empty-row">Пока нет вызовов ИИ.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    ),
  });
  sections.push({
    id: "funnel",
    label: "Воронка",
    content: (
      <section className="admin-block admin-funnel-block">
        <div className="admin-block-heading">
          <div>
            <h2>Воронка вовлечения</h2>
            <p>Текущее число аккаунтов на каждом этапе — не когорта по дате регистрации, а срез «сколько дошло до этого прямо сейчас». % — доля от всех зарегистрированных; «от пред. этапа» — доля от количества на предыдущей строке, то есть где именно теряется больше всего.</p>
          </div>
        </div>
        <div className="admin-funnel">
          {funnelStages.map((stage, index) => {
            const pctOfTotal = users.length ? Math.round((stage.count / users.length) * 100) : 0;
            const previous = funnelStages[index - 1];
            const pctOfPrevious = previous && previous.count ? Math.round((stage.count / previous.count) * 100) : null;
            return (
              <div className="admin-funnel-row" key={stage.id}>
                <span className="admin-funnel-label">{stage.label}</span>
                <div className="admin-funnel-track"><div className="admin-funnel-fill" style={{ width: `${pctOfTotal}%` }} /></div>
                <span className="admin-funnel-count">{formatNumber(stage.count)}</span>
                <span className="admin-funnel-pct">{pctOfTotal}%{pctOfPrevious !== null ? ` · от пред. этапа ${pctOfPrevious}%` : ""}</span>
              </div>
            );
          })}
          {!users.length && <p className="admin-empty-row">Пока нет ни одного аккаунта.</p>}
        </div>

        <div className="admin-block-heading admin-funnel-secondary-heading">
          <div>
            <h2>Способ регистрации</h2>
            <p>Как люди фактически заходят в кабинет — помогает понять, какой способ входа стоит продвигать заметнее.</p>
          </div>
        </div>
        <div className="admin-funnel">
          {signupMethodBreakdown.map((row) => {
            const pctOfTotal = users.length ? Math.round((row.count / users.length) * 100) : 0;
            return (
              <div className="admin-funnel-row" key={row.method}>
                <span className="admin-funnel-label">{row.label}</span>
                <div className="admin-funnel-track"><div className="admin-funnel-fill" style={{ width: `${pctOfTotal}%` }} /></div>
                <span className="admin-funnel-count">{formatNumber(row.count)}</span>
                <span className="admin-funnel-pct">{pctOfTotal}%</span>
              </div>
            );
          })}
        </div>

        <div className="admin-block-heading admin-funnel-secondary-heading">
          <div>
            <h2>Подключение соцсетей</h2>
            <p>Календарь публикаций работает только после подключения канала — это показывает, кто вообще дошёл до этого шага и какая площадка популярнее.</p>
          </div>
        </div>
        <div className="admin-funnel">
          <div className="admin-funnel-row">
            <span className="admin-funnel-label">Подключили хотя бы один канал</span>
            <div className="admin-funnel-track"><div className="admin-funnel-fill" style={{ width: `${users.length ? Math.round((socialChannelsConnectedCount / users.length) * 100) : 0}%` }} /></div>
            <span className="admin-funnel-count">{formatNumber(socialChannelsConnectedCount)}</span>
            <span className="admin-funnel-pct">{users.length ? Math.round((socialChannelsConnectedCount / users.length) * 100) : 0}%</span>
          </div>
          {socialChannelsBreakdown.map((row) => {
            const pctOfTotal = users.length ? Math.round((row.count / users.length) * 100) : 0;
            return (
              <div className="admin-funnel-row" key={row.id}>
                <span className="admin-funnel-label">{row.label}</span>
                <div className="admin-funnel-track"><div className="admin-funnel-fill" style={{ width: `${pctOfTotal}%` }} /></div>
                <span className="admin-funnel-count">{formatNumber(row.count)}</span>
                <span className="admin-funnel-pct">{pctOfTotal}%</span>
              </div>
            );
          })}
        </div>
      </section>
    ),
  });
  sections.push({
    id: "users",
    label: "Пользователи",
    badge: String(activeUsers.length),
    content: (
      <section className="admin-block">
        <h2>Пользователи ({activeUsers.length})</h2>
        <div className="admin-table-scroll admin-legacy-user-table">
          <AdminUsersTable users={activeUsers.map((item): AdminUserRow => ({
            email: item.email,
            displayName: item.displayName,
            emailStatus: item.emailVerified ? "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430" : "\u041d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430",
            createdAt: formatDate(item.createdAt),
            planName: item.planName,
            planExpires: formatPlanExpiry(item.planId, item.planExpiresAt, formatDate),
            planExpiryState: planExpiryState(item.planId, item.planExpiresAt),
            generations: `${item.generationsUsed} / ${item.generationLimit}`,
            research: `${item.researchUsed} / ${item.researchLimit}`,
            editor: `${item.editorActionsUsed} / ${item.editorActionLimit}`,
            brandCount: item.brandCount,
            brandProfileCompletion: item.brandProfileCompletion,
            textsGenerated: item.textsGenerated,
            textsEdited: item.textsEdited,
            textsManual: item.textsManual,
            contentPlans: item.contentPlans,
            semanticsRuns: item.semanticsRuns,
            competitorAnalyses: item.competitorAnalyses,
            publicationsCount: item.publicationsCount,
            socialChannelsVk: item.socialChannelsVk,
            socialChannelsTelegram: item.socialChannelsTelegram,
            everPaid: item.everPaid,
            signupMethod: SIGNUP_METHOD_LABELS[item.signupMethod] ?? item.signupMethod,
            registeredToday: item.registeredToday,
            totalCost: formatUsd(item.totalCostUsd),
            lastCallAt: formatDate(item.lastCallAt),
            invoiceRefs: item.invoiceRefs,
            transactionRefs: item.transactionRefs,
            payerNames: item.payerNames,
          }))} />
          <table className="admin-table admin-table-users-legacy">
            <thead>
              <tr>
                <th>Email</th>
                <th>Имя</th>
                <th>Почта</th>
                <th>Регистрация</th>
                <th>Тариф</th>
                <th>Действует до</th>
                <th>Генерации</th>
                <th>Семантика</th>
                <th>Редактор</th>
                <th>Брендов</th>
                <th>Расход</th>
                <th>Последний вызов ИИ</th>
              </tr>
            </thead>
            <tbody>
              {activeUsers.map((item) => (
                <tr key={item.email}>
                  <td>{item.email}</td>
                  <td>{item.displayName}</td>
                  <td>{item.emailVerified ? "Подтверждена" : "Не подтверждена"}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.planName}</td>
                  <td className={`admin-plan-expiry admin-plan-expiry-${planExpiryState(item.planId, item.planExpiresAt)}`}>{formatPlanExpiry(item.planId, item.planExpiresAt, formatDate)}</td>
                  <td>{item.generationsUsed} / {item.generationLimit}</td>
                  <td>{item.researchUsed} / {item.researchLimit}</td>
                  <td>{item.editorActionsUsed} / {item.editorActionLimit}</td>
                  <td>{item.brandCount}</td>
                  <td>{formatUsd(item.totalCostUsd)}</td>
                  <td>{formatDate(item.lastCallAt)}</td>
                </tr>
              ))}
              {!activeUsers.length && <tr><td colSpan={12} className="admin-empty-row">Пока нет подтверждённых пользователей.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    ),
  });
  sections.push({
    id: "payments",
    label: "Платежи",
    badge: String(paymentRows.length),
    content: (
      <section className="admin-block">
        <div className="admin-block-heading">
          <div>
            <h2>Платежи ({paymentRows.length})</h2>
            <p>Быстрая оплата СБП/картой из личного кабинета (не счета-фактуры — те см. в «Операции» у пользователя). Последние 200, сверяйте ID операции с кабинетом Точки.</p>
          </div>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>Email</th><th>Тариф</th><th>Период</th><th>Способ</th><th>Сумма</th><th>Статус</th><th>ID операции</th><th>Создан</th><th>Оплачен</th></tr></thead>
            <tbody>
              {paymentRows.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.ownerEmail}</td>
                  <td>{planRule(payment.planId).name}</td>
                  <td>{billingDescription(payment.billing as BillingPeriod)}</td>
                  <td>{payment.mode === "sbp" ? "СБП" : "Карта"}</td>
                  <td>{(payment.amountKopecks / 100).toLocaleString("ru-RU")} ₽</td>
                  <td className={`admin-payment-status admin-payment-status-${payment.status}`}>{PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}</td>
                  <td className="admin-payment-id">{payment.operationId || payment.id}</td>
                  <td>{formatDate(payment.createdAt)}</td>
                  <td>{formatDate(payment.paidAt)}</td>
                </tr>
              ))}
              {!paymentRows.length && <tr><td colSpan={9} className="admin-empty-row">Платежей пока не было.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    ),
  });

  if (pendingUsers.length > 0) {
    sections.push({
      id: "pending",
      label: "Ожидают подтверждения",
      badge: String(pendingUsers.length),
      content: (
        <section className="admin-block admin-pending-registrations">
          <h2>Ожидают подтверждения ({pendingUsers.length})</h2>
          <p className="admin-note">Это ещё не клиенты: аккаунты удаляются автоматически через 48 часов без подтверждения email.</p>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead><tr><th>Email</th><th>Имя</th><th>Регистрация</th><th>Статус</th></tr></thead>
              <tbody>{pendingUsers.map((item) => <tr key={item.email}><td>{item.email}</td><td>{item.displayName}</td><td>{formatDate(item.createdAt)}</td><td>Не подтверждена</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      ),
    });
  }

  sections.push({
    id: "plans",
    label: "Управление тарифами",
    content: <AdminAccountControls users={activeUsers.map((item) => ({ email: item.email, displayName: item.displayName, planId: item.planId, planName: item.planName, planExpiresAt: item.planExpiresAt }))} />,
  });

  sections.push({
    id: "feedback",
    label: "Обращения",
    badge: String(feedbackRows.length),
    content: (
      <section className="admin-block">
        <h2>Обращения ({feedbackRows.length})</h2>
        <p className="admin-note">«Задать вопрос» из рабочего пространства. Ответ виден отправителю прямо там же, в модальном окне.</p>
        <AdminFeedbackTable rows={feedbackRows.map((item) => ({
          id: item.id,
          ownerEmail: item.ownerEmail,
          message: item.message,
          reply: item.reply,
          repliedAt: item.repliedAt,
          createdAt: formatDate(item.createdAt),
        }))} />
      </section>
    ),
  });

  sections.push({
    id: "announcements",
    label: "Написать клиентам",
    badge: String(announcementRows.length),
    content: (
      <AdminAnnouncements
        users={activeUsers.map((item) => ({ email: item.email, displayName: item.displayName }))}
        rows={announcementRows.map((item) => ({
          id: item.id,
          message: item.message,
          recipientEmail: item.recipientEmail,
          createdAt: formatDate(item.createdAt),
        }))}
      />
    ),
  });

  return (
    <main className="admin-page">
      <AdminStyles />
      <header className="admin-header">
        <div>
          <p className="admin-kicker">КЛИО / Служебная страница</p>
          <h1>Пользователи и расходы на ИИ</h1>
        </div>
        <p className="admin-note">Видно только владельцу сайта. Обновляется при каждом заходе на страницу.</p>
        <AdminThemeToggle />
      </header>

      <section className="admin-cards">
        <article><span>Пользователей</span><b>{formatNumber(users.length)}</b><small>{formatNumber(verifiedCount)} с подтверждённой почтой</small></article>
        <article><span>Расход на ИИ · всего</span><b>{formatUsd(num(totals.totalCostUsd))}</b><small>{formatNumber(num(totals.totalCalls))} запросов, {formatNumber(num(totals.totalTokens))} токенов</small></article>
        <article><span>Расход на ИИ · 30 дней</span><b>{formatUsd(num(last30.totalCostUsd))}</b><small>{formatNumber(num(last30.totalCalls))} запросов</small></article>
        <article><span>Тариф</span><b>Старт (у всех)</b><small>оплата подписки пока не подключена</small></article>
      </section>

      <AdminShell sections={sections} />
    </main>
  );
}

function AdminStyles() {
  return (
    <style>{`
      .admin-page { max-width: 1680px; margin: 0 auto; padding: 40px 28px 80px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1f26; }
      .admin-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
      .admin-kicker { margin: 0 0 4px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; }
      .admin-header h1 { margin: 0; font-size: 26px; }
      .admin-note { margin: 0; font-size: 13px; color: #6b7280; }
      .admin-empty { color: #6b7280; font-size: 14px; }
      .admin-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 32px; }
      .admin-cards article { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; background: #fff; }
      .admin-cards span { display: block; font-size: 12px; color: #6b7280; margin-bottom: 6px; }
      .admin-cards b { display: block; font-size: 22px; }
      .admin-cards small { display: block; margin-top: 4px; font-size: 12px; color: #9ca3af; }
      .admin-shell { display: grid; grid-template-columns: 176px minmax(0, 1fr); align-items: start; gap: 18px; }
      .admin-sidebar nav { display: grid; gap: 4px; position: sticky; top: 20px; }
      .admin-sidebar button { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
      .admin-sidebar button:hover { background: rgba(100, 116, 139, 0.08); }
      .admin-sidebar button.active { border-color: #4f46e5; background: #4f46e5; color: #fff; }
      .admin-sidebar button em { flex: 0 0 auto; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-style: normal; font-weight: 700; background: rgba(100, 116, 139, 0.14); }
      .admin-sidebar button.active em { background: rgba(255, 255, 255, 0.22); }
      .admin-main { min-width: 0; }
      /* Grid items default to min-width:auto (at least their content's
         width), not 0 - without this, the mobile pill-nav's own
         overflow-x:auto (below) had nothing to clip against, so its
         intrinsic content width (all pills laid end to end) forced the
         whole .admin-shell single-column track wider than the viewport
         instead of scrolling within itself, dragging every section
         (funnel bars included) into the same horizontal overflow (site
         owner: "график... растягивается за границы экрана"). */
      .admin-sidebar { min-width: 0; }
      .admin-main .admin-block:last-child { margin-bottom: 0; }
      body[data-admin-theme="dark"] .admin-sidebar button:hover, body[data-admin-theme="dark"] .admin-sidebar button em { background: rgba(139, 92, 246, 0.16); }
      body[data-admin-theme="dark"] .admin-sidebar button.active { background: #4f46e5; }
      body[data-admin-theme="dark"] .admin-sidebar button.active em { background: rgba(255, 255, 255, 0.22); }
      @media (prefers-color-scheme: dark) { .admin-sidebar button:hover, .admin-sidebar button em { background: rgba(139, 92, 246, 0.16); } .admin-sidebar button.active em { background: rgba(255, 255, 255, 0.22); } }
      @media (max-width: 900px) {
        .admin-shell { grid-template-columns: 1fr; }
        /* Anchored like the workspace's own mobile bottom nav
           (textora-experience.tsx's .workspace-sidebar nav) instead of
           sitting inline above the content - site owner: "сделаем как в
           рабочей области внизу и закрепим". position: fixed (not
           sticky/relative-to-any-scroll-container) means it's anchored to
           the viewport itself, so it can never be nudged or covered by a
           table's own independent horizontal scroll (.admin-table-scroll)
           elsewhere on the page - the two scroll independently by
           construction, not by a z-index/containment hack. */
        .admin-sidebar { display: contents; }
        .admin-sidebar nav {
          position: fixed;
          /* The desktop rule's top: 20px (for position: sticky there)
             otherwise survives into this fixed position - top and bottom
             both set with no explicit height stretches the box to fill
             the gap between them, which is how this shipped its first
             try (a pill stretched almost the full viewport height). */
          top: auto;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 70;
          display: flex;
          gap: 8px;
          width: 100%;
          margin: 0;
          padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px));
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-inline: contain;
          scrollbar-width: none;
          border-top: 1px solid rgba(139, 110, 255, 0.24);
          background: linear-gradient(180deg, rgba(10, 16, 36, 0.92), rgba(8, 13, 30, 0.98));
          box-shadow: 0 -14px 30px rgba(3, 12, 28, 0.35);
          /* iOS Safari has a known bug where a position:fixed element's
             rendered position doesn't resync after a JS-driven layout
             change until the next scroll gesture (own compositing layer
             works around it) - relevant here because switching section
             (a big, instant height change via display:none, not a scroll)
             is exactly this bar's whole job. */
          transform: translateZ(0);
        }
        .admin-sidebar nav::-webkit-scrollbar { display: none; }
        .admin-sidebar button {
          flex: 0 0 auto;
          justify-content: flex-start;
          width: auto;
          min-height: 44px;
          padding: 8px 14px;
          border-radius: 999px;
          white-space: nowrap;
          /* Base rule's border/background are both transparent - fine
             against a page background, but on this bar every inactive
             pill disappeared into it, leaving only the active one reading
             as a real button (site owner: "кнопки сливаются с фоном"). */
          border-color: rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.06);
        }
        /* Room for the now-fixed bar so it never covers the last section's
           own content (mirrors .workspace-content's own bottom padding for
           the same reason). */
        .admin-main { padding-bottom: 88px; }
        body[data-admin-theme="light"] .admin-sidebar nav {
          border-top-color: rgba(36, 82, 184, 0.16);
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 -12px 28px rgba(15, 23, 42, 0.12);
        }
        body[data-admin-theme="light"] .admin-sidebar button {
          border-color: rgba(15, 23, 42, 0.14);
          background: rgba(15, 23, 42, 0.03);
        }
        .admin-sidebar button.active {
          border-color: #4f46e5;
        }
        /* Site owner: "карточки... давай сделаем более компактными и в два
           ряда" - auto-fit(minmax(200px,1fr)) already collapsed these 4 to
           one cramped column below ~430px (nothing fit two 200px+ cards
           side by side), each at full desktop padding/font size. Forcing
           2 columns plus smaller padding/type fits exactly 2 rows of 2. */
        .admin-cards { grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 20px; }
        .admin-cards article { padding: 10px 12px; }
        .admin-cards span { font-size: 11px; margin-bottom: 3px; }
        .admin-cards b { font-size: 17px; }
        .admin-cards small { font-size: 10px; margin-top: 2px; }
      }
      .admin-block { margin-bottom: 32px; }
      .admin-block h2 { font-size: 16px; margin: 0 0 10px; }
      .admin-block-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
      .admin-block-heading h2 { margin-bottom: 4px; }
      .admin-block-heading p { margin: 0; font-size: 12px; color: #6b7280; }
      .admin-refresh { flex: 0 0 auto; border: 1px solid #d1d5db; border-radius: 999px; padding: 7px 12px; color: inherit; font-size: 12px; font-weight: 700; text-decoration: none; }
      .admin-integrations { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
      .admin-integration { display: flex; min-height: 154px; flex-direction: column; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; background: #fff; }
      .admin-integration-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .admin-integration-top span { font-size: 13px; font-weight: 700; }
      .admin-integration-top i { border-radius: 999px; padding: 3px 7px; font-size: 10px; font-style: normal; font-weight: 700; }
      .admin-integration-connected i { background: #dcfce7; color: #166534; }
      .admin-integration-needs_setup i { background: #fef3c7; color: #92400e; }
      .admin-integration-unavailable i { background: #fee2e2; color: #991b1b; }
      .admin-integration b { display: block; margin-top: 14px; font-size: 20px; }
      .admin-integration small { display: block; margin-top: 5px; color: #6b7280; font-size: 12px; line-height: 1.4; }
      .admin-integration a { margin-top: auto; padding-top: 12px; color: #4f46e5; font-size: 12px; font-weight: 700; text-decoration: none; }
      .admin-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .admin-table th, .admin-table td { text-align: left; padding: 9px 10px; border-bottom: 1px solid rgba(148, 163, 184, 0.18); white-space: nowrap; }
      .admin-table th { color: #6b7280; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
      /* The base ".admin-table td" rule's white-space: nowrap (above) is
         what actually stopped this from wrapping — a plain .admin-feedback-
         message override (specificity 0,1,0) silently lost to that rule
         (0,1,1); table-layout: fixed with per-column pixel widths was a
         first attempt at working around that, but it broke on mobile
         (fixed columns wider than the 390px viewport squeezed the message
         column down to a single narrow one-word-per-line strip instead of
         a readable paragraph). min-width keeps this column from being
         squeezed that way — on a narrow screen the table just ends up
         wider than the viewport, same as the "Пользователи" table's own
         many columns, and scrolls horizontally via .admin-table-scroll
         exactly like that one already does, rather than reflowing. */
      .admin-table-feedback .admin-feedback-message { min-width: 260px; white-space: normal; word-break: break-word; }
      .admin-feedback-reply { min-width: 260px; vertical-align: top; }
      .admin-feedback-reply textarea { width: 100%; min-height: 64px; border: 1px solid #d1d5db; border-radius: 9px; padding: 8px 10px; background: #fff; color: #1c1f26; font: inherit; font-size: 13px; resize: vertical; }
      .admin-feedback-reply-actions { display: flex; gap: 8px; margin-top: 6px; }
      .admin-feedback-reply-error { margin: 6px 0 0; color: #b91c1c; font-size: 12px; }
      body[data-admin-theme="dark"] .admin-feedback-reply textarea { background: #171d3d; border-color: rgba(139, 110, 255, 0.3); color: #e5e7eb; }
      .admin-announcement-field { display: grid; gap: 6px; margin-bottom: 14px; color: #6b7280; font-size: 12px; font-weight: 700; }
      .admin-announcement-field textarea { width: 100%; min-height: 90px; border: 1px solid #d1d5db; border-radius: 9px; padding: 8px 10px; background: #fff; color: #1c1f26; font: inherit; font-size: 13px; resize: vertical; }
      body[data-admin-theme="dark"] .admin-announcement-field textarea { background: #171d3d; border-color: rgba(139, 110, 255, 0.3); color: #e5e7eb; }
      .admin-announcements-list { display: grid; gap: 10px; margin-top: 18px; }
      .admin-announcement-row { padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; }
      body[data-admin-theme="dark"] .admin-announcement-row { background: #171d3d; border-color: rgba(139, 110, 255, 0.24); }
      .admin-announcement-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; font-size: 12px; font-weight: 700; color: #4f46e5; }
      .admin-announcement-row-head small { color: #6b7280; font-weight: 500; }
      .admin-announcement-row p { margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
      .admin-plan-expiry-soon { color: #b45309; background: rgba(251, 191, 36, 0.12); font-weight: 700; }
      .admin-plan-expiry-critical, .admin-plan-expiry-expired { color: #b91c1c; background: rgba(248, 113, 113, 0.13); font-weight: 700; }
      .admin-plan-expiry-missing { color: #92400e; background: rgba(251, 191, 36, 0.16); font-weight: 700; }
      .admin-payment-status-pending { color: #b45309; background: rgba(251, 191, 36, 0.12); font-weight: 700; }
      .admin-payment-status-paid { color: #15803d; background: rgba(74, 222, 128, 0.14); font-weight: 700; }
      .admin-payment-status-refunded { color: #475569; background: rgba(148, 163, 184, 0.16); font-weight: 700; }
      .admin-payment-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      /* "Выделим линией пользователей, которые зарегистрировались сегодня" —
         a left accent stripe plus a faint tint, not a text badge, so it reads
         at a glance while scanning the table without adding another column. */
      .admin-user-row-new > td:first-child { box-shadow: inset 3px 0 0 #22c55e; }
      .admin-user-row-new > td { background: rgba(34, 197, 94, 0.08); }
      body[data-admin-theme="dark"] .admin-user-row-new > td { background: rgba(34, 197, 94, 0.13); }
      /* min-width matters as much as max-width here: table-layout:auto is
         free to shrink a wrap-allowed cell all the way down to its longest
         unbreakable word once the other (nowrap) columns' content already
         fills the container - that's what turned this into a one-word-per-
         line, several-hundred-pixel-tall cell in practice ("текст в
         последней графе растянулся вообще по вертикали"). A min-width is
         the actual fix: it stops the column collapsing, and pushes the
         table past the container width instead, which .admin-table-scroll
         already turns into a horizontal scrollbar rather than a crush. */
      .admin-ai-error { min-width: 150px; max-width: 320px; white-space: normal !important; overflow-wrap: anywhere; }
      .admin-empty-row { color: #9ca3af; white-space: normal; }
      .admin-funnel { display: grid; gap: 10px; }
      .admin-funnel-row { display: grid; grid-template-columns: 240px minmax(0,1fr) 60px 190px; align-items: center; gap: 12px; }
      .admin-funnel-label { font-size: 13px; font-weight: 600; }
      .admin-funnel-track { position: relative; height: 20px; border-radius: 999px; background: rgba(148, 163, 184, 0.18); overflow: hidden; }
      .admin-funnel-fill { height: 100%; border-radius: 999px; background: #4f46e5; }
      .admin-funnel-count { text-align: right; font-weight: 700; font-size: 13px; }
      .admin-funnel-pct { font-size: 12px; color: #6b7280; white-space: nowrap; }
      .admin-funnel-secondary-heading { margin-top: 28px; }
      @media (max-width: 800px) { .admin-funnel-row { grid-template-columns: 1fr; gap: 4px; } .admin-funnel-count, .admin-funnel-pct { text-align: left; } }
      .admin-table-scroll { overflow-x: auto; border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 16px; scrollbar-color: #64748b transparent; scrollbar-width: thin; }
      .admin-table-scroll::-webkit-scrollbar { height: 8px; }
      .admin-table-scroll::-webkit-scrollbar-track { background: transparent; }
      .admin-table-scroll::-webkit-scrollbar-thumb { background: #64748b; border-radius: 999px; }
      .admin-legacy-user-table { border: 0; overflow: visible; }
      .admin-table-users { min-width: 0; table-layout: auto; }
      .admin-table-users-legacy { display: none; }
      .admin-table-users td { vertical-align: middle; }
      .admin-user-muted { display: block; margin-top: 3px; color: #94a3b8; font-size: 11px; white-space: nowrap; }
      .admin-details-toggle { border: 1px solid #94a3b8; border-radius: 999px; padding: 6px 11px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; }
      .admin-details-toggle:hover { border-color: #8b5cf6; color: #8b5cf6; }
      .admin-user-details-row td { padding-top: 0 !important; }
      .admin-user-details { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 8px 18px; padding: 12px 14px 15px; border: 1px solid rgba(148,163,184,.25); border-radius: 12px; color: #cbd5e1; font-size: 12px; line-height: 1.45; }
      .admin-user-details > div { min-width: 0; overflow-wrap: break-word; }
      .admin-user-details-wide { grid-column: 1 / -1; }
      .admin-user-details b { color: #94a3b8; font-weight: 600; }
      .admin-users-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 0 0 10px; }
      .admin-users-toolbar label { color: #6b7280; font-size: 12px; font-weight: 700; }
      .admin-users-toolbar input { flex: 1 1 360px; min-width: 220px; min-height: 38px; border: 1px solid #d1d5db; border-radius: 999px; padding: 0 14px; background: #fff; color: #1c1f26; font: inherit; }
      .admin-users-toolbar input:focus { outline: 2px solid rgba(79, 70, 229, 0.25); outline-offset: 1px; border-color: #6366f1; }
      .admin-users-toolbar span { color: #6b7280; font-size: 12px; white-space: nowrap; }
      .admin-header-actions { display: flex; align-items: flex-end; gap: 12px; }
      .admin-theme-toggle, .admin-control-actions button { border: 1px solid #cbd5e1; border-radius: 999px; padding: 9px 13px; background: #fff; color: #1c1f26; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
      .admin-controls-grid { display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 12px; align-items: end; }
      .admin-controls-grid label { display: grid; gap: 6px; color: #6b7280; font-size: 12px; font-weight: 700; }
      .admin-controls-grid select, .admin-controls-grid input { min-height: 38px; border: 1px solid #d1d5db; border-radius: 9px; padding: 0 10px; background: #fff; color: #1c1f26; font: inherit; }
      .admin-duration-field { display: flex; gap: 6px; }
      .admin-duration-field input { flex: 1 1 auto; min-width: 0; }
      .admin-duration-field select { flex: 0 0 auto; }
      .admin-client-picker { display: grid; gap: 6px; }
      .admin-control-actions { display: flex; gap: 8px; }
      .admin-control-actions button:first-child { background: #4f46e5; border-color: #4f46e5; color: #fff; }
      .admin-danger-button { color: #b91c1c !important; }
      .admin-muted { color: #6b7280; font-size: 12px; }
      /* Deep navy, not near-black — #071525 flat was reading as black on
         most monitors despite technically having a blue channel. The
         gradient is fixed so it reads as one continuous backdrop behind the
         scrolling content instead of tiling/repeating. */
      body[data-admin-theme="dark"] { background: linear-gradient(160deg, #0a1330 0%, #0d2145 50%, #091a35 100%) fixed; color: #e5e7eb; }
      body[data-admin-theme="light"] { background: #f8fafc; color: #1c1f26; }
      body[data-admin-theme="dark"] .admin-page { color: #e5e7eb; }
      /* Flat #111d2d read as "black plates" (site owner) despite technically
         being navy - too close in lightness/saturation to the page's own
         dark gradient behind it to register as a lifted surface. A violet
         corner glow plus a warmer navy gradient (same language as
         /account's .account-card - see billing-actions.tsx) and a violet-
         tinted border instead of steel blue-gray ties this to KLIO's own
         accent (#4f46e5/#7c3aed, already the sidebar/button/funnel color)
         instead of an unrelated cool-gray palette. */
      body[data-admin-theme="dark"] .admin-cards article, body[data-admin-theme="dark"] .admin-integration, body[data-admin-theme="dark"] .admin-account-controls {
        background: radial-gradient(circle at 90% 0%, rgba(139, 92, 246, 0.20), transparent 35%), linear-gradient(150deg, #131c40 0%, #101a35 55%, #0b1428 100%);
        border-color: rgba(139, 110, 255, 0.24);
      }
      body[data-admin-theme="dark"] .admin-theme-toggle, body[data-admin-theme="dark"] .admin-controls-grid select, body[data-admin-theme="dark"] .admin-controls-grid input { background: #171d3d; border-color: rgba(139, 110, 255, 0.3); color: #e5e7eb; }
      body[data-admin-theme="dark"] .admin-users-toolbar input { background: #171d3d; border-color: rgba(139, 110, 255, 0.3); color: #e5e7eb; }
      @media (max-width: 800px) { .admin-controls-grid { grid-template-columns: 1fr; } .admin-header-actions { width: 100%; justify-content: space-between; align-items: center; } }
      @media (prefers-color-scheme: dark) {
        .admin-page { color: #e5e7eb; }
        .admin-cards article, .admin-integration {
          background: radial-gradient(circle at 90% 0%, rgba(139, 92, 246, 0.20), transparent 35%), linear-gradient(150deg, #131c40 0%, #101a35 55%, #0b1428 100%);
          border-color: rgba(139, 110, 255, 0.24);
        }
        .admin-block-heading p, .admin-integration small { color: #a0a7b4; }
        .admin-refresh { border-color: rgba(139, 110, 255, 0.3); }
        .admin-integration-connected i { background: #153d2a; color: #86efac; }
        .admin-integration-needs_setup i { background: #4a3610; color: #fde68a; }
        .admin-integration-unavailable i { background: #4a1d24; color: #fca5a5; }
        .admin-table th, .admin-table td { border-color: rgba(148, 163, 184, 0.16); }
        .admin-table-scroll { border-color: rgba(148, 163, 184, 0.26); }
      }
      body[data-admin-theme="light"] .admin-page { color: #1c1f26; }
      body[data-admin-theme="light"] .admin-cards article, body[data-admin-theme="light"] .admin-integration, body[data-admin-theme="light"] .admin-account-controls { background: #fff; border-color: #e5e7eb; }
      body[data-admin-theme="light"] .admin-block-heading p, body[data-admin-theme="light"] .admin-integration small { color: #6b7280; }
      body[data-admin-theme="light"] .admin-table th, body[data-admin-theme="light"] .admin-table td { border-color: rgba(148, 163, 184, 0.22); }
      @media (max-width: 1100px) { .admin-table-users th:nth-child(4), .admin-table-users td:nth-child(4), .admin-table-users th:nth-child(12), .admin-table-users td:nth-child(12) { display: none; } .admin-user-details { grid-template-columns: repeat(2, minmax(180px, 1fr)); } }
      @media (max-width: 700px) { .admin-user-details { grid-template-columns: 1fr; } }
    `}</style>
  );
}
