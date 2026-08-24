import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { requireCurrentUser } from "../identity";
import { getDb } from "../../db";
import { brands } from "../../db/schema";
import { accountSummary, ensureAccount, workspaceDatabaseAvailable } from "../api/_lib/workspace-account";
import BillingActions from "./billing-actions";
import InvoiceDocuments from "./invoice-documents";
import PaymentHistory from "./payment-history";

export const metadata = { title: "КЛИО / Личный кабинет" };

// Server component — rendered in the host's UTC, not the visitor's Moscow
// time, so pin the zone explicitly (see the matching note in admin/page.tsx)
// or a date near midnight MSK shows the wrong day.
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "long", year: "numeric" });
}

// Same soon/critical/expired/missing bands as /admin (see planExpiryState in
// ../plans) — phrased for the account holder instead of a table cell. Only
// called for non-trial plans, so `value` is only null in the "missing" case.
function planExpiryLabel(state: string, value: string | null | undefined): string {
  if (state === "missing") return "Срок действия не задан";
  if (state === "expired") return `Тариф истёк ${formatDate(value)}`;
  return `Действует до ${formatDate(value)}`;
}

function Progress({ label, used, remaining, limit }: { label: string; used: number; remaining: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="account-progress">
      <div><span>{label}</span><b>{remaining} <small>из {limit} осталось</small></b></div>
      <i><u style={{ width: `${percent}%` }} /></i>
    </div>
  );
}

export default async function AccountPage() {
  const user = await requireCurrentUser("/account");

  if (!await workspaceDatabaseAvailable()) {
    return (
      <main className="account-page">
        <AccountStyles />
        <div className="account-content">
          <p className="account-empty">Хранилище кабинета сейчас недоступно. Попробуйте открыть эту страницу чуть позже.</p>
        </div>
      </main>
    );
  }

  const account = await ensureAccount({ ...user, fullName: user.displayName });
  const db = getDb();
  const [{ count = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(brands)
    .where(eq(brands.ownerEmail, user.email));
  const summary = accountSummary(account, Number(count));

  return (
    <main className="account-page">
      <AccountStyles />
      <div className="account-content">
        <header className="account-header">
          <Link className="account-back" href="/workspace">← В рабочее пространство</Link>
          <div className="account-who"><i>{(user.displayName || "К").trim().charAt(0).toLocaleUpperCase("ru-RU")}</i><span><b>{user.displayName}</b><small>{user.email}</small></span></div>
        </header>

        <div className="account-title"><p>Личный кабинет</p><h1>Тариф и данные аккаунта</h1></div>

        <section className="account-card account-plan-card">
          <div className="account-plan-head">
            <div>
              <span>Текущий тариф</span>
              <h2>{summary.planName}</h2>
              <small>1 пользователь на всех тарифах · лимиты обновляются ежемесячно</small>
              {summary.planId !== "trial" && <small className={`account-plan-expiry account-plan-expiry-${summary.planExpiryState}`}>{planExpiryLabel(summary.planExpiryState, summary.planExpiresAt)}</small>}
            </div>
            <a className="account-upgrade" href="#billing">Выбрать тариф</a>
          </div>
          <div className="account-progress-grid">
            <Progress label="Материалы" used={summary.generationsUsed} remaining={summary.generationsRemaining} limit={summary.generationLimit} />
            <Progress label="Исследования" used={summary.researchUsed} remaining={summary.researchRemaining} limit={summary.researchLimit} />
            <Progress label="AI‑редактура" used={summary.editorActionsUsed} remaining={summary.editorActionsRemaining} limit={summary.editorActionLimit} />
          </div>
          <small className="account-plan-note">Брендов подключено: {summary.brandCount} из {summary.brandLimit}. Нужен другой тариф или больше лимитов раньше конца месяца — напишите нам, оплата и смена тарифа пока оформляются вручную.</small>
        </section>

        <section className="account-card account-billing-card" id="billing">
          <span>Платный доступ</span>
          <h2>Выберите тариф и способ оплаты</h2>
          <p className="account-billing-lead">Оплата открывается из личного кабинета и привязывается к вашему аккаунту. СБП — быстрый способ, карта также доступна.</p>
          <BillingActions />
          <PaymentHistory />
          <InvoiceDocuments />
        </section>

        <section className="account-card">
          <span>Данные аккаунта</span>
          <dl className="account-facts">
            <div><dt>Имя</dt><dd>{user.displayName}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>В КЛИО с</dt><dd>{formatDate(account.createdAt)}</dd></div>
          </dl>
        </section>
      </div>
    </main>
  );
}

function AccountStyles() {
  return (
    <style>{`
      .account-page { width: 100%; min-height: 100vh; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 15px; color: #fff; background: radial-gradient(circle at 85% 0%, rgba(124,58,237,0.22), transparent 32%), linear-gradient(165deg, #041326 0%, #082947 60%, #051b31 100%); }
      .account-content { max-width: 840px; margin: 0 auto; padding: 48px 28px 90px; }
      .account-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 36px; flex-wrap: wrap; }
      .account-back { color: rgba(255,255,255,0.62); font-size: 15px; text-decoration: none; }
      .account-back:hover { color: #fff; }
      .account-who { display: flex; align-items: center; gap: 12px; }
      .account-who i { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; font-size: 17px; font-style: normal; font-weight: 700; color: var(--night); background: var(--acid); }
      .account-who span { display: flex; flex-direction: column; }
      .account-who b { font-size: 16px; }
      .account-who small { color: rgba(255,255,255,0.55); font-size: 13px; }
      .account-title p { margin: 0 0 8px; color: var(--acid); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .account-title h1 { margin: 0 0 32px; font-size: 40px; letter-spacing: -0.02em; }
      .account-card { margin-bottom: 22px; padding: 28px 30px; border: 1px solid rgba(255,255,255,0.16); border-radius: 4px 28px 4px 4px; background: radial-gradient(circle at 92% 0%, rgba(124,58,237,0.26), transparent 32%), linear-gradient(135deg, #0a2340, #082b4c 55%, #061c34 100%); box-shadow: 0 24px 70px rgba(3,12,26,0.3), inset 0 1px rgba(255,255,255,0.1); }
      .account-card > span { display: block; margin-bottom: 14px; color: #d5c9fb; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .account-plan-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
      .account-plan-head span { color: #d5c9fb; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .account-plan-head h2 { margin: 6px 0 6px; font-size: 30px; }
      .account-plan-head small { color: rgba(255,255,255,0.55); font-size: 14px; }
      .account-plan-expiry { display: block; margin-top: 6px; font-weight: 700; }
      .account-plan-expiry-soon, .account-plan-expiry-missing { color: #fbbf24; }
      .account-plan-expiry-critical, .account-plan-expiry-expired { color: #f87171; }
      .account-upgrade { flex-shrink: 0; padding: 11px 18px; border-radius: 999px; color: var(--night); font-size: 15px; font-weight: 700; text-decoration: none; background: var(--acid); }
      .account-upgrade:hover { opacity: 0.88; }
      .account-billing-card h2 { margin: 0 0 8px; font-size: 28px; }
      .account-billing-lead { max-width: 620px; margin: 0 0 22px; color: rgba(255,255,255,0.62); line-height: 1.55; }
      .account-billing-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .account-select { position: relative; display: grid; gap: 7px; }
      .account-select-label { color: rgba(255,255,255,0.62); font-size: 13px; font-weight: 700; }
      .account-select-trigger { min-height: 48px; padding: 0 13px; display: flex; align-items: center; justify-content: space-between; border: 1px solid rgba(255,255,255,0.16); border-radius: 14px; background: rgba(3,14,29,0.3); color: #fff; font: inherit; text-align: left; cursor: pointer; }
      .account-select-trigger.is-open { border-color: var(--acid); box-shadow: 0 0 0 2px rgba(207,255,62,0.18); }
      .account-select-chevron { margin-left: 12px; color: var(--acid); font-size: 22px; line-height: 1; transform: translateY(-2px); }
      .account-select-menu { position: absolute; z-index: 30; top: calc(100% + 7px); left: 0; right: 0; padding: 6px; border: 1px solid rgba(255,255,255,0.2); border-radius: 16px; background: #102d4a; box-shadow: 0 18px 40px rgba(0,0,0,0.35); }
      .account-select-option { width: 100%; padding: 11px 12px; border: 0; border-radius: 10px; background: transparent; color: rgba(255,255,255,0.82); font: inherit; text-align: left; cursor: pointer; }
      .account-select-option:hover, .account-select-option.is-selected { background: rgba(255,255,255,0.12); color: var(--acid); }
      .account-billing-consent { display: flex; align-items: flex-start; gap: 9px; margin: 18px 0; color: rgba(255,255,255,0.6); font-size: 13px; line-height: 1.45; }
      .account-billing-consent input { margin-top: 3px; accent-color: var(--acid); }
      .account-billing-consent a, .account-billing-buttons a { color: var(--acid); }
      .account-billing-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .account-billing-buttons button, .account-billing-buttons a { min-height: 46px; padding: 0 16px; border: 0; border-radius: 999px; font: inherit; font-weight: 750; text-decoration: none; cursor: pointer; }
      .account-billing-buttons button { background: var(--acid); color: var(--night); }
      .account-billing-buttons button + button { background: rgba(255,255,255,0.12); color: #fff; }
      .account-billing-buttons button:disabled { opacity: .5; cursor: not-allowed; }
      .account-billing-buttons a { display: inline-flex; align-items: center; border: 1px solid rgba(255,255,255,0.22); }
      .account-documents { margin-top: 28px; padding-top: 22px; border-top: 1px solid rgba(255,255,255,0.13); }
      .account-documents-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
      .account-documents-heading h3 { margin: 0 0 6px; font-size: 20px; }
      .account-documents-heading p { margin: 0; color: rgba(255,255,255,0.58); }
      .account-documents-clear { flex-shrink: 0; min-height: 38px; padding: 0 14px; border: 1px solid rgba(255,154,166,0.4); border-radius: 999px; background: transparent; color: #ff9aa6; font: inherit; font-weight: 700; cursor: pointer; }
      .account-documents-clear:hover { background: rgba(255,154,166,0.1); }
      .account-documents-clear:disabled { opacity: .5; cursor: wait; }
      .account-document { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 0; border-top: 1px solid rgba(255,255,255,0.09); }
      .account-document > div:first-child { display: grid; gap: 4px; }
      .account-document small { color: rgba(255,255,255,0.52); }
      .account-document-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
      .account-document-actions button, .account-document-actions a { display: inline-flex; align-items: center; min-height: 38px; padding: 0 14px; border: 0; border-radius: 999px; color: var(--night); background: var(--acid); font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
      .account-document-actions button:disabled { opacity: .55; cursor: wait; }
      .account-document-actions button.account-document-delete { border: 1px solid rgba(255,154,166,0.4); background: transparent; color: #ff9aa6; }
      .account-document-actions button.account-document-delete:hover { background: rgba(255,154,166,0.1); }
      .account-payment-status { flex-shrink: 0; padding: 7px 10px; border-radius: 999px; font-size: 13px; font-weight: 750; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.72); }
      .account-payment-status-paid { color: #d9ff85; background: rgba(152, 220, 73, 0.14); }
      .account-payment-status-refunded { color: #ffb4bd; background: rgba(255, 110, 126, 0.14); }
      .account-billing-error { margin: 14px 0 0; color: #ff9aa6; font-weight: 700; }
      .account-progress-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px; margin-bottom: 18px; }
      .account-plan-card .account-progress-grid { align-items: stretch; }
      .account-plan-card .account-progress { min-width: 0; display: flex; flex-direction: column; }
      .account-progress > div { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
      .account-progress span { color: rgba(255,255,255,0.62); font-size: 14px; }
      .account-progress b { font-size: 20px; font-weight: 650; }
      .account-progress b small { color: rgba(255,255,255,0.5); font-size: 13px; font-weight: 500; }
      .account-progress i { display: block; height: 5px; border-radius: 4px; overflow: hidden; background: rgba(255,255,255,0.12); }
      .account-plan-card .account-progress i { margin-top: auto; }
      .account-plan-card .account-progress u { display: block; height: 100%; background: linear-gradient(90deg, #8f7cf5, #638bd8); }
      .account-plan-card .account-upgrade { color: #fff; background: linear-gradient(135deg, #6654c8, #8574e8); box-shadow: 0 8px 18px rgba(73, 57, 168, 0.2); }
      .account-plan-card .account-upgrade:hover { opacity: 1; background: linear-gradient(135deg, #5b49b9, #7664d8); }
      .account-plan-note { display: block; color: rgba(255,255,255,0.55); font-size: 14px; line-height: 1.55; }
      .account-facts { display: grid; gap: 12px; margin: 0; }
      .account-facts > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      .account-facts > div:last-child { border-bottom: none; padding-bottom: 0; }
      .account-facts dt { color: rgba(255,255,255,0.55); font-size: 15px; }
      .account-facts dd { margin: 0; font-size: 16px; font-weight: 600; text-align: right; }
      .account-empty { display: block; padding-top: 8px; font-size: 15px; color: rgba(255,255,255,0.6); }

      /* Light theme - this page renders its own inline <style> instead of
         globals.css, but data-theme is still set on <html> by the same
         bootstrap script for every route, so scoping to it here works
         identically. Same conversion table as every other module: acid
         text -> #2452b8 (unreadable on light), #d5c9fb lilac labels ->
         #2452b8, acid+night pairings (.account-who i avatar,
         .account-upgrade pill) and the acid progress-bar fill left
         theme-agnostic since none of them are text needing contrast
         against the page's own background. */
      [data-theme="light"] .account-page { color: #0d1b31; background: radial-gradient(circle at 85% 0%, rgba(53,104,212,0.12), transparent 32%), linear-gradient(165deg, #e3eaf6 0%, #f0f4fa 60%, #ffffff 100%); }
      [data-theme="light"] .account-back { color: rgba(13,27,49,0.6); }
      [data-theme="light"] .account-back:hover { color: #0d1b31; }
      [data-theme="light"] .account-who small { color: rgba(13,27,49,0.5); }
      [data-theme="light"] .account-title p { color: #2452b8; }
      [data-theme="light"] .account-card { border-color: rgba(15,23,42,0.14); background: radial-gradient(circle at 92% 0%, rgba(53,104,212,0.16), transparent 32%), linear-gradient(135deg, #e3eaf6, #f0f4fa 55%, #ffffff 100%); box-shadow: 0 24px 70px rgba(20,40,80,0.1), inset 0 1px #fff; }
      [data-theme="light"] .account-card > span { color: #2452b8; }
      [data-theme="light"] .account-plan-head span { color: #2452b8; }
      [data-theme="light"] .account-plan-head small { color: rgba(13,27,49,0.5); }
      [data-theme="light"] .account-plan-expiry-soon, [data-theme="light"] .account-plan-expiry-missing { color: #b45309; }
      [data-theme="light"] .account-plan-expiry-critical, [data-theme="light"] .account-plan-expiry-expired { color: #b91c1c; }
      [data-theme="light"] .account-billing-lead, [data-theme="light"] .account-select-label, [data-theme="light"] .account-billing-consent { color: rgba(13,27,49,0.62); }
      [data-theme="light"] .account-select-trigger { border-color: rgba(15,23,42,0.16); background: rgba(255,255,255,0.7); color: #0d1b31; }
      [data-theme="light"] .account-select-trigger.is-open { border-color: #5b4bb7; box-shadow: 0 0 0 2px rgba(91,75,183,0.16); }
      [data-theme="light"] .account-select-chevron { color: #5b4bb7; }
      [data-theme="light"] .account-select-menu { border-color: rgba(15,23,42,0.16); background: #fff; box-shadow: 0 18px 40px rgba(15,23,42,0.18); }
      [data-theme="light"] .account-select-option { color: #0d1b31; }
      [data-theme="light"] .account-select-option:hover, [data-theme="light"] .account-select-option.is-selected { background: rgba(15,23,42,0.08); color: #3656c9; }
      [data-theme="light"] .account-billing-buttons button + button { color: #0d1b31; background: rgba(15,23,42,0.1); }
      [data-theme="light"] .account-billing-buttons a { border-color: rgba(15,23,42,0.18); }
      [data-theme="light"] .account-billing-buttons button:first-child,
      [data-theme="light"] .account-billing-buttons button + button:not(:disabled),
      [data-theme="light"] .account-document-actions button,
      [data-theme="light"] .account-document-actions a { color: #fff; background: linear-gradient(135deg, #5b4bb7, #7568d1); box-shadow: 0 8px 18px rgba(74,60,163,0.18); }
      [data-theme="light"] .account-billing-buttons button:first-child:hover,
      [data-theme="light"] .account-billing-buttons button + button:not(:disabled):hover,
      [data-theme="light"] .account-document-actions button:hover,
      [data-theme="light"] .account-document-actions a:hover { background: linear-gradient(135deg, #4f40a7, #6659c1); }
      [data-theme="light"] .account-billing-buttons button:disabled { color: rgba(13,27,49,0.45); background: rgba(15,23,42,0.1); box-shadow: none; }
      [data-theme="light"] .account-billing-buttons a { color: #5b4bb7; }
      [data-theme="light"] .account-documents { border-top-color: rgba(15,23,42,0.12); }
      [data-theme="light"] .account-document { border-top-color: rgba(15,23,42,0.09); }
      [data-theme="light"] .account-documents-heading p, [data-theme="light"] .account-document small { color: rgba(13,27,49,0.56); }
      [data-theme="light"] .account-documents-clear { border-color: rgba(198,40,40,0.35); color: #c62828; }
      [data-theme="light"] .account-documents-clear:hover { background: rgba(198,40,40,0.08); }
      [data-theme="light"] .account-document-actions button.account-document-delete { border-color: rgba(198,40,40,0.35); color: #c62828; background: transparent; box-shadow: none; }
      [data-theme="light"] .account-document-actions button.account-document-delete:hover { background: rgba(198,40,40,0.08); box-shadow: none; }
      [data-theme="light"] .account-payment-status { color: rgba(13,27,49,0.68); background: rgba(15,23,42,0.08); }
      [data-theme="light"] .account-payment-status-paid { color: #2f6a10; background: rgba(83, 150, 35, 0.14); }
      [data-theme="light"] .account-payment-status-refunded { color: #b91c1c; background: rgba(198,40,40,0.1); }
      [data-theme="light"] .account-progress span { color: rgba(13,27,49,0.6); }
      [data-theme="light"] .account-progress b small { color: rgba(13,27,49,0.45); }
      [data-theme="light"] .account-progress i { background: rgba(15,23,42,0.1); }
      [data-theme="light"] .account-plan-card .account-progress u { background: linear-gradient(90deg, #6654c8, #7b8fd8); }
      [data-theme="light"] .account-plan-card .account-upgrade { color: #fff; background: linear-gradient(135deg, #5b4bb7, #7568d1); box-shadow: 0 8px 18px rgba(74,60,163,0.18); }
      [data-theme="light"] .account-plan-card .account-upgrade:hover { background: linear-gradient(135deg, #4f40a7, #6659c1); }
      [data-theme="light"] .account-plan-note { color: rgba(13,27,49,0.5); }
      [data-theme="light"] .account-facts > div { border-bottom-color: rgba(15,23,42,0.08); }
      [data-theme="light"] .account-facts dt { color: rgba(13,27,49,0.5); }
      [data-theme="light"] .account-empty { color: rgba(13,27,49,0.55); }
      @media (max-width: 640px) { .account-content { padding: 28px 16px 72px; } .account-billing-selects { grid-template-columns: 1fr; } .account-billing-buttons { align-items: stretch; flex-direction: column; } .account-billing-buttons button, .account-billing-buttons a { width: 100%; justify-content: center; } .account-document { align-items: flex-start; flex-direction: column; } .account-documents-heading { flex-direction: column; align-items: stretch; } .account-documents-clear { align-self: flex-start; } }
    `}</style>
  );
}
