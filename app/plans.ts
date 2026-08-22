export type PlanId = "trial" | "start" | "pro" | "agency";

export type PlanRule = {
  id: PlanId;
  name: string;
  generationLimit: number;
  researchLimit: number;
  editorActionLimit: number;
  brandLimit: number;
  seatLimit: 1;
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
    periodLabel: "в месяц",
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "trial" || value === "start" || value === "pro" || value === "agency";
}

export function planRule(value: unknown): PlanRule {
  return PLAN_RULES[isPlanId(value) ? value : "start"];
}
