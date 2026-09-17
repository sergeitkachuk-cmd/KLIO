export type BillingPeriod = "monthly" | "quarterly" | "halfyear" | "annual";

/** Public subscription prices in rubles. Keep this as the single source of truth
 * for the invoice form and the server-side payment endpoints. */
export const PLAN_PRICES = {
  start: { monthly: 1190, yearly: 950, name: "Старт" },
  pro: { monthly: 2750, yearly: 2200, name: "Профи" },
  agency: { monthly: 6590, yearly: 5290, name: "Агентство" },
} as const;

// PlanId (app/plans.ts) has grown admin-only, non-purchasable members
// ("trial", "comp") that deliberately have no entry here — the payment
// routes' own `!PLAN_PRICES[planId]` check already rejects those at
// runtime, but a plain PlanId index into this narrower object doesn't
// prove that to the type checker. A real type guard does.
export function isPurchasablePlan(id: string): id is keyof typeof PLAN_PRICES {
  return id in PLAN_PRICES;
}

export const BILLING_PERIODS: Array<{
  id: BillingPeriod;
  label: string;
  months: number;
  discount: number;
}> = [
  { id: "monthly", label: "1 месяц", months: 1, discount: 0 },
  { id: "quarterly", label: "3 месяца", months: 3, discount: 5 },
  { id: "halfyear", label: "6 месяцев", months: 6, discount: 10 },
  { id: "annual", label: "12 месяцев", months: 12, discount: 20 },
];

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return BILLING_PERIODS.some((period) => period.id === value);
}

export function periodAmount(monthly: number, yearly: number, billing: BillingPeriod) {
  if (billing === "annual") return yearly * 12;
  const period = BILLING_PERIODS.find((item) => item.id === billing) ?? BILLING_PERIODS[0];
  return Math.round(monthly * period.months * (1 - period.discount / 100));
}

export function billingDescription(billing: BillingPeriod) {
  return BILLING_PERIODS.find((period) => period.id === billing)?.label ?? BILLING_PERIODS[0].label;
}

// Launch window for KLIO's first trial cohort (site owner, 2026-09-17: ~50
// signups in one day, almost no activity, zero conversions yet) — a
// one-time 20% discount, monthly billing only ("скидка ... на любой тариф
// на месяц"), through end of September. Not an evergreen discount: the
// deadline below and the per-account launchDiscountUsedAt gate (see
// db/schema.ts and accountSummary in api/_lib/workspace-account.ts) are
// both required so this can't be reused after a first purchase or resurface
// once the launch window has closed.
export const LAUNCH_DISCOUNT_PERCENT = 20;
export const LAUNCH_DISCOUNT_BILLING: BillingPeriod = "monthly";
// 2026-09-30 23:59:59 Europe/Moscow (UTC+3).
export const LAUNCH_DISCOUNT_DEADLINE = "2026-09-30T20:59:59.000Z";

export function launchDiscountWindowOpen(now: Date = new Date()): boolean {
  return now.getTime() <= new Date(LAUNCH_DISCOUNT_DEADLINE).getTime();
}

export function applyLaunchDiscount(amountRub: number): number {
  return Math.round(amountRub * (1 - LAUNCH_DISCOUNT_PERCENT / 100));
}
