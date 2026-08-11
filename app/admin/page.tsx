import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { getCurrentUser } from "../identity";
import { isAdminEmail } from "../api/_lib/admin";
import type { AiOperation } from "../api/_lib/ai-config";
import { getDb } from "../../db";
import { accounts, aiUsage, brands } from "../../db/schema";
import { planRule } from "../plans";

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

  const [userRows, usageByUser, brandCounts, totalsRows, last30Rows, byModelRows, byOperationRows] = await Promise.all([
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
  ]);

  const usageMap = new Map(usageByUser.map((row) => [row.ownerEmail, row]));
  const brandMap = new Map(brandCounts.map((row) => [row.ownerEmail, num(row.count)]));

  const users = userRows.map((account) => {
    const plan = planRule(account.planId);
    const usage = usageMap.get(account.email);
    return {
      email: account.email,
      displayName: account.displayName,
      emailVerified: account.emailVerified,
      createdAt: account.createdAt,
      planName: plan.name,
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
    };
  });

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
      </header>

      <section className="admin-cards">
        <article><span>Пользователей</span><b>{formatNumber(users.length)}</b><small>{formatNumber(verifiedCount)} с подтверждённой почтой</small></article>
        <article><span>Расход на ИИ · всего</span><b>{formatUsd(num(totals.totalCostUsd))}</b><small>{formatNumber(num(totals.totalCalls))} запросов, {formatNumber(num(totals.totalTokens))} токенов</small></article>
        <article><span>Расход на ИИ · 30 дней</span><b>{formatUsd(num(last30.totalCostUsd))}</b><small>{formatNumber(num(last30.totalCalls))} запросов</small></article>
        <article><span>Тариф</span><b>Старт (у всех)</b><small>оплата подписки пока не подключена</small></article>
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
        <h2>Пользователи ({users.length})</h2>
        <div className="admin-table-scroll">
          <table className="admin-table admin-table-users">
            <thead>
              <tr>
                <th>Email</th>
                <th>Имя</th>
                <th>Почта</th>
                <th>Регистрация</th>
                <th>Тариф</th>
                <th>Генерации</th>
                <th>Семантика</th>
                <th>Редактор</th>
                <th>Брендов</th>
                <th>Расход</th>
                <th>Последний вызов ИИ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.email}>
                  <td>{item.email}</td>
                  <td>{item.displayName}</td>
                  <td>{item.emailVerified ? "Подтверждена" : "Не подтверждена"}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.planName}</td>
                  <td>{item.generationsUsed} / {item.generationLimit}</td>
                  <td>{item.researchUsed} / {item.researchLimit}</td>
                  <td>{item.editorActionsUsed} / {item.editorActionLimit}</td>
                  <td>{item.brandCount}</td>
                  <td>{formatUsd(item.totalCostUsd)}</td>
                  <td>{formatDate(item.lastCallAt)}</td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={11} className="admin-empty-row">Пока нет зарегистрированных пользователей.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function AdminStyles() {
  return (
    <style>{`
      .admin-page { max-width: 1180px; margin: 0 auto; padding: 40px 24px 80px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1f26; }
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
      .admin-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .admin-table th, .admin-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef0f3; white-space: nowrap; }
      .admin-table th { color: #6b7280; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
      .admin-empty-row { color: #9ca3af; white-space: normal; }
      .admin-table-scroll { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 12px; }
      .admin-table-users { min-width: 1000px; }
      @media (prefers-color-scheme: dark) {
        .admin-page { color: #e5e7eb; }
        .admin-cards article { background: #14161b; border-color: #262933; }
        .admin-table th, .admin-table td { border-color: #262933; }
        .admin-table-scroll { border-color: #262933; }
      }
    `}</style>
  );
}
