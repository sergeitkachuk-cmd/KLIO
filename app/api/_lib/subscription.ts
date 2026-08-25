import type { BillingPeriod } from "../../billing-pricing";

const PERIOD_MONTHS: Record<BillingPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  halfyear: 6,
  annual: 12,
};

// Adds `months` to `base`, clamping the day-of-month so e.g. Jan 31 + 1
// month lands on Feb 28/29 instead of overflowing into March.
function addMonthsClamped(base: Date, months: number) {
  const day = base.getUTCDate();
  const result = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Returns the new UTC subscription end, extending a still-active plan. */
export function subscriptionExpiry(previous: string | null | undefined, billing: BillingPeriod, now = new Date()) {
  const previousDate = previous ? new Date(previous) : null;
  const base = previousDate && Number.isFinite(previousDate.getTime()) && previousDate > now ? previousDate : now;
  return addMonthsClamped(base, PERIOD_MONTHS[billing]).toISOString();
}

// Usage-quota counters (generations/research/editor actions) refresh every
// month regardless of billing period — a customer who pays annually still
// gets a fresh monthly allowance, not one lump sum for the year. This
// anchors that monthly refresh to the payment date instead of the calendar
// month (see ensureAccount() in workspace-account.ts, and the product
// requirement this fixes: paid-plan quotas reset 30 days from payment, not
// on the 1st of the calendar month). Call with the payment/last-reset
// moment to get the next reset.
export function nextQuotaPeriodEnd(from: Date) {
  return addMonthsClamped(from, 1).toISOString();
}
