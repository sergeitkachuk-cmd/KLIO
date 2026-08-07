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
        <p className="account-empty">Хранилище кабинета сейчас недоступно. Попробуйте открыть эту страницу чуть позже.</p>
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
    </main>
  );
}

function AccountStyles() {
  return (
    <style>{`
      .account-page { max-width: 760px; margin: 0 auto; padding: 40px 24px 80px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; background: radial-gradient(circle at 85% 0%, rgba(124,58,237,0.22), transparent 32%), linear-gradient(165deg, #041326 0%, #082947 60%, #051b31 100%); min-height: 100vh; }
      .account-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
      .account-back { color: rgba(255,255,255,0.62); font-size: 13px; text-decoration: none; }
      .account-back:hover { color: #fff; }
      .account-who { display: flex; align-items: center; gap: 10px; }
      .account-who i { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; font-style: normal; font-weight: 700; color: var(--night); background: var(--acid); }
      .account-who span { display: flex; flex-direction: column; }
      .account-who b { font-size: 14px; }
      .account-who small { color: rgba(255,255,255,0.55); font-size: 12px; }
      .account-title p { margin: 0 0 6px; color: var(--acid); font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .account-title h1 { margin: 0 0 28px; font-size: 30px; letter-spacing: -0.02em; }
      .account-card { margin-bottom: 20px; padding: 24px 26px; border: 1px solid rgba(255,255,255,0.16); border-radius: 4px 28px 4px 4px; background: radial-gradient(circle at 92% 0%, rgba(124,58,237,0.26), transparent 32%), linear-gradient(135deg, #0a2340, #082b4c 55%, #061c34 100%); box-shadow: 0 24px 70px rgba(3,12,26,0.3), inset 0 1px rgba(255,255,255,0.1); }
      .account-card > span { display: block; margin-bottom: 12px; color: #d5c9fb; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .account-plan-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
      .account-plan-head span { color: #d5c9fb; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .account-plan-head h2 { margin: 4px 0 4px; font-size: 24px; }
      .account-plan-head small { color: rgba(255,255,255,0.55); font-size: 12px; }
      .account-upgrade { flex-shrink: 0; padding: 10px 16px; border-radius: 999px; color: var(--night); font-size: 13px; font-weight: 700; text-decoration: none; background: var(--acid); }
      .account-upgrade:hover { opacity: 0.88; }
      .account-progress-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 16px; }
      .account-progress > div { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .account-progress span { color: rgba(255,255,255,0.62); font-size: 12px; }
      .account-progress b { font-size: 16px; font-weight: 650; }
      .account-progress b small { color: rgba(255,255,255,0.5); font-size: 11px; font-weight: 500; }
      .account-progress i { display: block; height: 4px; border-radius: 4px; overflow: hidden; background: rgba(255,255,255,0.12); }
      .account-progress u { display: block; height: 100%; background: linear-gradient(90deg, var(--acid), #fff); }
      .account-plan-note { display: block; color: rgba(255,255,255,0.55); font-size: 12px; line-height: 1.5; }
      .account-facts { display: grid; gap: 10px; margin: 0; }
      .account-facts > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      .account-facts > div:last-child { border-bottom: none; padding-bottom: 0; }
      .account-facts dt { color: rgba(255,255,255,0.55); font-size: 13px; }
      .account-facts dd { margin: 0; font-size: 13px; font-weight: 600; text-align: right; }
      .account-empty { color: rgba(255,255,255,0.6); }
    `}</style>
  );
}
