// "comp" is a hand-granted goodwill period (admin-only, see
// admin-account-controls.tsx) — distinct from "trial" (the automatic,
// tightly-limited 48h window every new signup starts on) for cases like
// compensating an account that hit a real bug on day one. Never
// purchasable: PLAN_PRICES in billing-pricing.ts has no "comp" entry, and
// every payment route already rejects any planId missing from there.
export type PlanId = "trial" | "start" | "pro" | "agency" | "comp";

export type PlanRule = {
  id: PlanId;
  name: string;
  generationLimit: number;
  researchLimit: number;
  editorActionLimit: number;
  // Dialogue mode's plain conversational turns (advice/discussion — the
  // "chat" and brand-onboarding "profile" intents, not topics/text/image,
  // which produce actual content and draw on researchLimit/generationLimit
  // instead, the same as their professional-mode equivalents). Split out
  // 2026-09-20 from editorActionLimit, which every dialogue reply used to
  // debit regardless of intent (site owner: "это недосмотр, стоит
  // развести" — see the accounts.dialogueActionsUsed column comment).
  dialogueActionLimit: number;
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
    // Doubled 2026-09-20 alongside every paid plan below - dialogue mode's
    // own text/image generations now correctly draw on this same pool
    // (previously miscounted as an editor action for text, so this pool
    // saw none of that traffic before), not a change in what a single
    // material itself costs.
    generationLimit: 10,
    researchLimit: 3,
    editorActionLimit: 5,
    dialogueActionLimit: 8,
    brandLimit: 1,
    seatLimit: 1,
    channelLimit: 0,
    periodLabel: "за пробный период",
  },
  start: {
    id: "start",
    name: "Старт",
    // 60 per brand (site owner, 2026-09-20: doubled from 30 when dialogue
    // mode's own text/image generations were correctly reclassified onto
    // this pool instead of editorActionLimit — see the PlanRule field's own
    // comment). Every other paid plan's generationLimit is this same
    // 60-per-brand rate × brandLimit.
    generationLimit: 60,
    // 10 per brand (site owner, 2026-09-17). Same per-brand-rate model as
    // generationLimit above — every other paid plan's researchLimit is
    // this rate × brandLimit.
    researchLimit: 10,
    editorActionLimit: 100,
    // 150 per brand (site owner, 2026-09-20, confirmed): dialogue's plain
    // chat turns are lighter than a professional-mode editor action, so
    // this starts above editorActionLimit rather than matching it —
    // retune once real usage data comes in.
    dialogueActionLimit: 150,
    brandLimit: 1,
    seatLimit: 1,
    channelLimit: 1,
    periodLabel: "в месяц",
  },
  pro: {
    id: "pro",
    name: "Профи",
    // Five brands × start's 60-per-brand rate.
    generationLimit: 300,
    // Five brands × start's 10-per-brand rate.
    researchLimit: 50,
    editorActionLimit: 500,
    // Five brands × start's 150-per-brand rate.
    dialogueActionLimit: 700,
    brandLimit: 5,
    seatLimit: 1,
    channelLimit: 3,
    periodLabel: "в месяц",
  },
  agency: {
    id: "agency",
    name: "Агентство",
    // Ten brands × start's 60-per-brand rate — already was 300 before the
    // 2026-09-17 rate change (it was already the most generous per-brand
    // ratio of the three), so this one didn't need to move that time; it
    // doubled to 600 in the same 2026-09-20 pass as start/pro above.
    generationLimit: 600,
    // Ten brands × start's 10-per-brand rate.
    researchLimit: 100,
    editorActionLimit: 1000,
    // Ten brands × start's 150-per-brand rate.
    dialogueActionLimit: 1500,
    brandLimit: 10,
    seatLimit: 1,
    channelLimit: 10,
    periodLabel: "в месяц",
  },
  comp: {
    id: "comp",
    name: "Тестовый период",
    // Roomier than trial's 5/3/5 — this is meant to actually let someone
    // properly try the product, not just poke at it for two days. Tracks
    // start's own generationLimit/researchLimit/dialogueActionLimit (one
    // brand, same rate) so a courtesy grant is never stingier than the
    // cheapest real plan.
    generationLimit: 60,
    researchLimit: 10,
    editorActionLimit: 100,
    dialogueActionLimit: 150,
    brandLimit: 1,
    seatLimit: 1,
    channelLimit: 1,
    periodLabel: "за тестовый период",
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "trial" || value === "start" || value === "pro" || value === "agency" || value === "comp";
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
