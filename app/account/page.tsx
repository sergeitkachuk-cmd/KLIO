import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { requireCurrentUser } from "../identity";
import { getDb } from "../../db";
import { brands } from "../../db/schema";
import { accountSummary, ensureAccount, workspaceDatabaseAvailable } from "../api/_lib/workspace-account";

export const metadata = { title: "КЛИО / Личный кабинет" };

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
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
            <div><span>Текущий тариф</span><h2>{summary.planName}</h2><small>1 пользователь на всех тарифах · лимиты обновляются ежемесячно</small></div>
            <Link className="account-upgrade" href="/#pricing">Сравнить тарифы</Link>
          </div>
          <div className="account-progress-grid">
            <Progress label="Материалы" used={summary.generationsUsed} remaining={summary.generationsRemaining} limit={summary.generationLimit} />
            <Progress label="Исследования" used={summary.researchUsed} remaining={summary.researchRemaining} limit={summary.researchLimit} />
            <Progress label="AI‑редактура" used={summary.editorActionsUsed} remaining={summary.editorActionsRemaining} limit={summary.editorActionLimit} />
          </div>
          <small className="account-plan-note">Брендов подключено: {summary.brandCount} из {summary.brandLimit}. Нужен другой тариф или больше лимитов раньше конца месяца — напишите нам, оплата и смена тарифа пока оформляются вручную.</small>
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
      .account-upgrade { flex-shrink: 0; padding: 11px 18px; border-radius: 999px; color: var(--night); font-size: 15px; font-weight: 700; text-decoration: none; background: var(--acid); }
      .account-upgrade:hover { opacity: 0.88; }
      .account-progress-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px; margin-bottom: 18px; }
      .account-progress > div { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
      .account-progress span { color: rgba(255,255,255,0.62); font-size: 14px; }
      .account-progress b { font-size: 20px; font-weight: 650; }
      .account-progress b small { color: rgba(255,255,255,0.5); font-size: 13px; font-weight: 500; }
      .account-progress i { display: block; height: 5px; border-radius: 4px; overflow: hidden; background: rgba(255,255,255,0.12); }
      .account-progress u { display: block; height: 100%; background: linear-gradient(90deg, var(--acid), #fff); }
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
      [data-theme="light"] .account-progress span { color: rgba(13,27,49,0.6); }
      [data-theme="light"] .account-progress b small { color: rgba(13,27,49,0.45); }
      [data-theme="light"] .account-progress i { background: rgba(15,23,42,0.1); }
      [data-theme="light"] .account-plan-note { color: rgba(13,27,49,0.5); }
      [data-theme="light"] .account-facts > div { border-bottom-color: rgba(15,23,42,0.08); }
      [data-theme="light"] .account-facts dt { color: rgba(13,27,49,0.5); }
      [data-theme="light"] .account-empty { color: rgba(13,27,49,0.55); }
    `}</style>
  );
}
