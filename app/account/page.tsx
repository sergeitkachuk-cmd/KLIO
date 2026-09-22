import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { requireCurrentUser } from "../identity";
import { getDb } from "../../db";
import { brands } from "../../db/schema";
import { accountSummary, ensureAccount, workspaceDatabaseAvailable } from "../api/_lib/workspace-account";
import { LAUNCH_DISCOUNT_PERCENT } from "../billing-pricing";
import BillingActions from "./billing-actions";
import InvoiceDocuments from "./invoice-documents";
import PaymentHistory from "./payment-history";
import "./account.css";

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

// Day-only granularity (formatDate above) is fine for a plan that runs for
// months, but reads as ambiguous for the trial's 72h window — "до 15
// августа" doesn't say whether that's 00:01 or 23:59. Trial's own expiry
// line below uses this instead.
function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
}

// Same soon/critical/expired/missing bands as /admin (see planExpiryState in
// ../plans) — phrased for the account holder instead of a table cell.
// accountSummary() feeds the trial's own createdAt+72h deadline through the
// same planExpiresAt/planExpiryState fields a paid plan's real expiry uses
// (see the comment there), so this only needs its own wording for trial,
// not a separate branch to detect when there's nothing to show — `value` is
// only null for a paid plan in the "missing" state (an admin grant with no
// expiry) or the practically-impossible case of a trial with a corrupt
// createdAt.
function planExpiryLabel(planId: string, state: string, value: string | null | undefined): string {
  if (planId === "trial") {
    return state === "expired" ? `Пробный период закончился ${formatDate(value)}` : `Пробный доступ до ${formatDateTime(value)}`;
  }
  if (state === "missing") return "Срок действия не задан";
  if (state === "expired") return `Тариф истёк ${formatDate(value)}`;
  return `Действует до ${formatDate(value)}`;
}

// Paid plans that went through a real payment reset on that payment's own
// date (see quotaPeriodEndsAt in db/schema.ts); a paid plan an admin
// granted by hand falls back to a generic monthly-refresh note instead
// since there is no payment date to anchor to. The trial never resets —
// it just runs out after its fixed 72h window (see assertTrialActive).
function quotaResetLabel(planId: string, quotaResetsAt: string | null | undefined): string {
  if (planId === "trial") return "лимиты действуют один раз, на весь пробный период";
  if (!quotaResetsAt) return "лимиты обновляются ежемесячно";
  return `лимиты обновятся ${formatDate(quotaResetsAt)}`;
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
      <div className="account-content">
        <header className="account-header">
          <Link className="account-back" href="/workspace">← В рабочее пространство</Link>
          <div className="account-who"><i>{(user.displayName || "К").trim().charAt(0).toLocaleUpperCase("ru-RU")}</i><span><b>{user.displayName}</b><small>{user.email}</small></span></div>
        </header>

        <div className="account-title"><p>Личный кабинет</p><h1>Тариф и данные аккаунта</h1></div>

        {summary.launchDiscountAvailable && (
          <section className="launch-discount-banner">
            <div className="launch-discount-banner-copy">
              <p className="launch-discount-banner-kicker">КЛИО / Для первых клиентов</p>
              <h2>Дарим скидку {LAUNCH_DISCOUNT_PERCENT}%<span className="klio-mark-dot">.</span></h2>
              <p>Мы только запустились и будем развиваться вместе с вами — персональная скидка {LAUNCH_DISCOUNT_PERCENT}% на любой тариф при оплате на 1 месяц. Разовое предложение, действует до конца сентября.</p>
            </div>
            <a className="launch-discount-banner-cta" href="#billing">Выбрать тариф со скидкой →</a>
          </section>
        )}

        <section className="account-card account-plan-card">
          <div className="account-plan-head">
            <div>
              <span>Текущий тариф</span>
              <h2>{summary.planName}</h2>
              <small>1 пользователь на всех тарифах · {quotaResetLabel(summary.planId, summary.quotaResetsAt)}</small>
              <small className={`account-plan-expiry account-plan-expiry-${summary.planExpiryState}`}>{planExpiryLabel(summary.planId, summary.planExpiryState, summary.planExpiresAt)}</small>
            </div>
            <a className="account-upgrade" href="#billing">Выбрать тариф</a>
          </div>
          <div className="account-progress-grid">
            <Progress label="Материалы" used={summary.generationsUsed} remaining={summary.generationsRemaining} limit={summary.generationLimit} />
            <Progress label="Исследования" used={summary.researchUsed} remaining={summary.researchRemaining} limit={summary.researchLimit} />
            <Progress label="AI‑редактура" used={summary.editorActionsUsed} remaining={summary.editorActionsRemaining} limit={summary.editorActionLimit} />
            <Progress label="Диалог" used={summary.dialogueActionsUsed} remaining={summary.dialogueActionsRemaining} limit={summary.dialogueActionLimit} />
          </div>
          <small className="account-plan-note">Брендов подключено: {summary.brandCount} из {summary.brandLimit}. Нужен другой тариф или больше лимитов раньше конца периода — <a href="#billing">оформите оплату</a>, доступ обновится автоматически.</small>
        </section>

        <section className="account-card account-billing-card" id="billing">
          <span>Платный доступ</span>
          <h2>Выберите тариф и способ оплаты</h2>
          <p className="account-billing-lead">Оплата открывается из личного кабинета и привязывается к вашему аккаунту. СБП — быстрый способ, карта также доступна.</p>
          <BillingActions launchDiscountAvailable={summary.launchDiscountAvailable} />
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
