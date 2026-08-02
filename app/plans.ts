export type PlanId = "start" | "pro" | "agency";

export type PlanRule = {
  id: PlanId;
  name: string;
  generationLimit: number;
  researchLimit: number;
  editorActionLimit: number;
  brandLimit: number;
  seatLimit: 1;
};

export const PLAN_RULES: Record<PlanId, PlanRule> = {
  start: {
    id: "start",
    name: "Старт",
    generationLimit: 20,
    researchLimit: 10,
    editorActionLimit: 100,
    brandLimit: 1,
    seatLimit: 1,
  },
  pro: {
    id: "pro",
    name: "Профи",
    generationLimit: 100,
    researchLimit: 50,
    editorActionLimit: 500,
    brandLimit: 5,
    seatLimit: 1,
  },
  agency: {
    id: "agency",
    name: "Агентство",
    generationLimit: 300,
    researchLimit: 150,
    editorActionLimit: 2000,
    brandLimit: 10,
    seatLimit: 1,
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "start" || value === "pro" || value === "agency";
}

export function planRule(value: unknown): PlanRule {
  return PLAN_RULES[isPlanId(value) ? value : "start"];
}
