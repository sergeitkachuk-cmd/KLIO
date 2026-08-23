import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "../identity";
import { isAdminEmail } from "../api/_lib/admin";
import type { AiOperation } from "../api/_lib/ai-config";
import { getDb } from "../../db";
import { accounts, aiUsage, asyncJobs, brands, emailVerifications, generations, invoices, materials, passwordResets, payments, sessions } from "../../db/schema";
import { planRule } from "../plans";
import { getExternalServiceStatuses } from "../api/_lib/external-service-status";
import { AdminThemeToggle } from "./admin-theme-toggle";
import { AdminAccountControls } from "./admin-account-controls";
import { AdminUsersTable, type AdminUserRow } from "./admin-users-table";

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

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatNumber(value: number): string {
  return value.toLocaleString("ru-RU");
}

function planExpiryState(planId: string, value: string | null | undefined): "soon" | "critical" | "expired" | "missing" | "normal" {
  if (!value) return planId === "trial" ? "normal" : "missing";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "normal";
  const days = (time - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days <= 1) return "critical";
  if (days <= 5) return "soon";
  return "normal";
}

function formatPlanExpiry(planId: string, value: string | null | undefined): string {
  if (value) return formatDate(value);
  return planId === "trial" ? "Пробный период" : "Срок не задан";
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
  normalize_quick_brief: "Разбор брифа (nano)",
  validate_content: "Проверка качества (nano)",
  condense_overflow: "Сжатие переполнения (nano)",
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

  const [userRows, usageByUser, brandCounts, invoiceRefsByUser, transactionRefsByUser, totalsRows, last30Rows, byModelRows, byOperationRows, externalServices] = await Promise.all([
    db.select().from(accounts).orderBy(desc(accounts.createdAt)),
    db.select({
      ownerEmail: aiUsage.ownerEmail,
      totalCostUsd: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)`,
      totalCalls: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)`,
      lastCallAt: sql<string>`max(${aiUsage.createdAt})`,
    }).from(aiUsage).groupBy(aiUsage.ownerEmail),
    db.select({
      ownerEmail: brands.ownerEmail,
      count: sql<number>`count(*)`,
    }).from(brands).groupBy(brands.ownerEmail),
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
    }).from(aiUsage).groupBy(aiUsage.operation).orderBy(sql`sum(${aiUsage.estimatedCostUsd}) desc`),
    getExternalServiceStatuses(),
  ]);

  const usageMap = new Map(usageByUser.map((row) => [row.ownerEmail, row]));
  const brandMap = new Map(brandCounts.map((row) => [row.ownerEmail, num(row.count)]));
  const invoiceMap = new Map(invoiceRefsByUser.map((row) => [row.ownerEmail, row]));
  const transactionMap = new Map(transactionRefsByUser.map((row) => [row.ownerEmail, row.transactionRefs]));

  const users = userRows.map((account) => {
    const plan = planRule(account.planId);
    const usage = usageMap.get(account.email);
    return {
      email: account.email,
      displayName: account.displayName,
      emailVerified: account.emailVerified,
      createdAt: account.createdAt,
      planName: plan.name,
      planId: account.planId,
      planExpiresAt: account.planExpiresAt,
      generationsUsed: account.generationsUsed,
      generationLimit: plan.generationLimit,
      researchUsed: account.researchUsed,
      researchLimit: plan.researchLimit,
      editorActionsUsed: account.editorActionsUsed,
      editorActionLimit: plan.editorActionLimit,
      brandCount: brandMap.get(account.email) ?? 0,
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

  const totals = totalsRows[0] ?? { totalCostUsd: 0, totalCalls: 0, totalTokens: 0 };
  const last30 = last30Rows[0] ?? { totalCostUsd: 0, totalCalls: 0 };
  const verifiedCount = users.filter((item) => item.emailVerified).length;

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

      <section className="admin-block">
        <h2>Расход по операциям</h2>
        <table className="admin-table">
          <thead><tr><th>Операция</th><th>Запросов</th><th>Расход</th></tr></thead>
          <tbody>
            {byOperationRows.map((row) => (
              <tr key={row.operation}>
                <td>{OPERATION_LABELS[row.operation as AiOperation] ?? row.operation}</td>
                <td>{formatNumber(num(row.totalCalls))}</td>
                <td>{formatUsd(num(row.totalCostUsd))}</td>
              </tr>
            ))}
            {!byOperationRows.length && <tr><td colSpan={3} className="admin-empty-row">Пока нет вызовов ИИ.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="admin-block">
        <h2>Пользователи ({activeUsers.length})</h2>
        <div className="admin-table-scroll admin-legacy-user-table">
          <AdminUsersTable users={activeUsers.map((item): AdminUserRow => ({
            email: item.email,
            displayName: item.displayName,
            emailStatus: item.emailVerified ? "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430" : "\u041d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430",
            createdAt: formatDate(item.createdAt),
            planName: item.planName,
            planExpires: formatPlanExpiry(item.planId, item.planExpiresAt),
            planExpiryState: planExpiryState(item.planId, item.planExpiresAt),
            generations: `${item.generationsUsed} / ${item.generationLimit}`,
            research: `${item.researchUsed} / ${item.researchLimit}`,
            editor: `${item.editorActionsUsed} / ${item.editorActionLimit}`,
            brandCount: item.brandCount,
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
                  <td className={`admin-plan-expiry admin-plan-expiry-${planExpiryState(item.planId, item.planExpiresAt)}`}>{formatPlanExpiry(item.planId, item.planExpiresAt)}</td>
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
      {pendingUsers.length > 0 && <section className="admin-block admin-pending-registrations">
        <h2>Ожидают подтверждения ({pendingUsers.length})</h2>
        <p className="admin-note">Это ещё не клиенты: аккаунты удаляются автоматически через 48 часов без подтверждения email.</p>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>Email</th><th>Имя</th><th>Регистрация</th><th>Статус</th></tr></thead>
            <tbody>{pendingUsers.map((item) => <tr key={item.email}><td>{item.email}</td><td>{item.displayName}</td><td>{formatDate(item.createdAt)}</td><td>Не подтверждена</td></tr>)}</tbody>
          </table>
        </div>
      </section>}
      <AdminAccountControls users={activeUsers.map((item) => ({ email: item.email, displayName: item.displayName, planId: item.planId, planName: item.planName, planExpiresAt: item.planExpiresAt }))} />
    </main>
  );
}

function AdminStyles() {
  return (
    <style>{`
      .admin-page { max-width: 1440px; margin: 0 auto; padding: 40px 28px 80px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1f26; }
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
      .admin-plan-expiry-soon { color: #b45309; background: rgba(251, 191, 36, 0.12); font-weight: 700; }
      .admin-plan-expiry-critical, .admin-plan-expiry-expired { color: #b91c1c; background: rgba(248, 113, 113, 0.13); font-weight: 700; }
      .admin-plan-expiry-missing { color: #92400e; background: rgba(251, 191, 36, 0.16); font-weight: 700; }
      .admin-empty-row { color: #9ca3af; white-space: normal; }
      .admin-table-scroll { overflow-x: auto; border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 16px; scrollbar-color: #64748b transparent; scrollbar-width: thin; }
      .admin-table-scroll::-webkit-scrollbar { height: 8px; }
      .admin-table-scroll::-webkit-scrollbar-track { background: transparent; }
      .admin-table-scroll::-webkit-scrollbar-thumb { background: #64748b; border-radius: 999px; }
      .admin-legacy-user-table { border: 0; overflow: visible; }
      .admin-table-users { min-width: 0; table-layout: auto; }
      .admin-table-users-legacy { display: none; }
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
      .admin-control-actions { display: flex; gap: 8px; }
      .admin-control-actions button:first-child { background: #4f46e5; border-color: #4f46e5; color: #fff; }
      .admin-danger-button { color: #b91c1c !important; }
      .admin-muted { color: #6b7280; font-size: 12px; }
      body[data-admin-theme="dark"] { background: #071525; color: #e5e7eb; }
      body[data-admin-theme="light"] { background: #f8fafc; color: #1c1f26; }
      body[data-admin-theme="dark"] .admin-page { color: #e5e7eb; }
      body[data-admin-theme="dark"] .admin-cards article, body[data-admin-theme="dark"] .admin-integration, body[data-admin-theme="dark"] .admin-account-controls { background: #111d2d; border-color: #2c4059; }
      body[data-admin-theme="dark"] .admin-theme-toggle, body[data-admin-theme="dark"] .admin-controls-grid select, body[data-admin-theme="dark"] .admin-controls-grid input { background: #17263a; border-color: #3a506b; color: #e5e7eb; }
      body[data-admin-theme="dark"] .admin-users-toolbar input { background: #17263a; border-color: #3a506b; color: #e5e7eb; }
      @media (max-width: 800px) { .admin-controls-grid { grid-template-columns: 1fr; } .admin-header-actions { width: 100%; justify-content: space-between; align-items: center; } }
      @media (prefers-color-scheme: dark) {
        .admin-page { color: #e5e7eb; }
        .admin-cards article { background: #14161b; border-color: #262933; }
        .admin-integration { background: #14161b; border-color: #262933; }
        .admin-block-heading p, .admin-integration small { color: #a0a7b4; }
        .admin-refresh { border-color: #3b404d; }
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
      @media (max-width: 1100px) { .admin-table-users th:nth-child(4), .admin-table-users td:nth-child(4), .admin-table-users th:nth-child(12), .admin-table-users td:nth-child(12) { display: none; } }
    `}</style>
  );
}
