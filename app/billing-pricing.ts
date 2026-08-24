export type BillingPeriod = "monthly" | "quarterly" | "halfyear" | "annual";

/** Public subscription prices in rubles. Keep this as the single source of truth
 * for the invoice form and the server-side payment endpoints. */
export const PLAN_PRICES = {
  start: { monthly: 1190, yearly: 950, name: "Старт" },
  pro: { monthly: 2750, yearly: 2200, name: "Профи" },
  agency: { monthly: 6590, yearly: 5290, name: "Агентство" },
} as const;

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
