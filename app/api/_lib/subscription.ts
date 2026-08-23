import type { BillingPeriod } from "../../billing-pricing";

const PERIOD_MONTHS: Record<BillingPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  halfyear: 6,
  annual: 12,
};

/** Returns the new UTC subscription end, extending a still-active plan. */
export function subscriptionExpiry(previous: string | null | undefined, billing: BillingPeriod, now = new Date()) {
  const previousDate = previous ? new Date(previous) : null;
  const base = previousDate && Number.isFinite(previousDate.getTime()) && previousDate > now ? previousDate : now;
  const day = base.getUTCDate();
  const result = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  result.setUTCMonth(result.getUTCMonth() + PERIOD_MONTHS[billing]);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString();
}
