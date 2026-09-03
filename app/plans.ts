export type PlanId = "trial" | "start" | "pro" | "agency";

export type PlanRule = {
  id: PlanId;
  name: string;
  generationLimit: number;
  researchLimit: number;
  editorActionLimit: number;
  brandLimit: number;
  seatLimit: 1;
  // Total VK/Telegram channels connectable across all of the account's
  // brands (see socialChannels in db/schema.ts) — this is the "Публикации"
  // module's own upsell lever, deliberately not folded into brandLimit or
  // generationLimit: connecting a channel costs nothing in AI tokens, its
  // real cost is the ongoing integration/support surface per channel, so it
  // gets its own axis. Zero on trial keeps that period scoped to content
  // only, same reasoning as its already-tight generation/research limits.
  channelLimit: number;
  // Human-readable quota window for "limit exceeded" messages — plain
  // plans reset monthly; the trial's window is fixed and short instead.
  periodLabel: string;
};

// New signups start here (see ensureAccount in api/_lib/workspace-account.ts)
// and get TRIAL_DURATION_MS (48h, defined there) of work before every
// AI-costing action is blocked outright — see assertTrialActive.
export const PLAN_RULES: Record<PlanId, PlanRule> = {
  trial: {
    id: "trial",
    name: "Пробный",
    generationLimit: 5,
    researchLimit: 3,
    editorActionLimit: 5,
    brandLimit: 1,
    seatLimit: 1,
    channelLimit: 0,
    periodLabel: "за пробный период",
  },
  start: {
    id: "start",
    name: "Старт",
    // A full content plan contains 25 publication slots. The entry plan must
    // let a customer actually generate the whole first plan for one brand.
    generationLimit: 25,
    researchLimit: 5,
    editorActionLimit: 100,
    brandLimit: 1,
    seatLimit: 1,
    channelLimit: 1,
    periodLabel: "в месяц",
  },
  pro: {
    id: "pro",
    name: "Профи",
    // Five brands × one complete 25-topic content plan.
    generationLimit: 125,
    researchLimit: 20,
    editorActionLimit: 500,
    brandLimit: 5,
    seatLimit: 1,
    channelLimit: 3,
    periodLabel: "в месяц",
  },
  agency: {
    id: "agency",
    name: "Агентство",
    generationLimit: 300,
    researchLimit: 60,
    editorActionLimit: 1000,
    brandLimit: 10,
    seatLimit: 1,
    channelLimit: 10,
    periodLabel: "в месяц",
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "trial" || value === "start" || value === "pro" || value === "agency";
}

export function planRule(value: unknown): PlanRule {
  return PLAN_RULES[isPlanId(value) ? value : "start"];
}

// Shared by the admin users table and the account page's plan card so both
// surfaces flag an approaching/expired paid plan the same way.
export type PlanExpiryState = "soon" | "critical" | "expired" | "missing" | "normal";

export function planExpiryState(planId: string, value: string | null | undefined): PlanExpiryState {
  if (!value) return planId === "trial" ? "normal" : "missing";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "normal";
  const days = (time - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days <= 1) return "critical";
  if (days <= 5) return "soon";
  return "normal";
}

export function formatPlanExpiry(planId: string, value: string | null | undefined, formatDate: (value: string) => string): string {
  if (value) return formatDate(value);
  return planId === "trial" ? "Пробный период" : "Срок не задан";
}
