// Single source of truth for KLIO's AI routing: which model handles which
// operation, at what reasoning effort, with what output budget. Nothing
// outside this file should hardcode a model id, a reasoning effort level,
// or an OpenAI price — see ai-router.ts for the call site that reads this
// config, and every app/api/*/route.ts for the operations that use it.

export const AI_MODELS = {
  // Full-tier model: everything the visitor directly reads or publishes —
  // articles, posts, ads, landing copy, content plans, editor rewrites,
  // competitor analysis, semantic research.
  CONTENT: "gpt-5.6-luna",
  // Small/fast model: short, formalized, non-creative steps — parsing a
  // freeform brief into structured fields, a semantic QA pass over an
  // already-written draft. Never used to produce user-facing prose.
  UTILITY: "gpt-5.4-nano",
} as const;

export type AiModelId = (typeof AI_MODELS)[keyof typeof AI_MODELS];

// If UTILITY is unavailable, a *retryable* short task may run on CONTENT
// once nano's own retries are exhausted (recorded as a fallback in
// ai_usage). CONTENT has no fallback: a full article is never silently
// downgraded to the utility model.
export const FALLBACKS: Record<AiModelId, AiModelId | null> = {
  [AI_MODELS.UTILITY]: AI_MODELS.CONTENT,
  [AI_MODELS.CONTENT]: null,
};

export const MODEL_PRICING: Record<AiModelId, {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}> = {
  "gpt-5.6-luna": { inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 6 },
  "gpt-5.4-nano": { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 },
};

export function estimateCostUsd(model: AiModelId, usage: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): number {
  const pricing = MODEL_PRICING[model];
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (uncachedInput / 1_000_000) * pricing.inputPerMillion
    + (usage.cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion
    + (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

// KLIO's real operations. Every one the spec's illustrative list named
// that has no corresponding KLIO feature (email campaigns, press
// releases, product cards, slug generation, standalone metadata-only
// endpoints...) was left out rather than stubbed — see the router
// integration report for the full mapping and reasoning.
export type AiOperation =
  // Luna — user-facing generation
  | "generate_seo_article"
  | "generate_social_post"
  | "generate_ad_copy"
  | "generate_landing"
  | "generate_quick_material"
  | "adapt_text"
  | "generate_content_plan"
  | "revise_content_plan"
  | "research_semantics"
  | "discover_competitors"
  | "analyze_competitors"
  | "revise_content"
  | "analyze_brand_website"
  // Nano — short formalized steps
  | "normalize_quick_brief"
  | "validate_content"
  | "condense_overflow";

export type ReasoningEffort = "none" | "low" | "medium";

export type OperationConfig = {
  model: AiModelId;
  reasoningEffort: ReasoningEffort;
  maxOutputTokens: number;
  structuredOutput: boolean;
  retryable: boolean;
  useWebSearch: boolean;
};

const { CONTENT, UTILITY } = AI_MODELS;

export const OPERATION_CONFIG: Record<AiOperation, OperationConfig> = {
  generate_seo_article: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 10_000, structuredOutput: true, retryable: true, useWebSearch: true },
  generate_social_post: { model: CONTENT, reasoningEffort: "none", maxOutputTokens: 2_500, structuredOutput: true, retryable: true, useWebSearch: true },
  generate_ad_copy: { model: CONTENT, reasoningEffort: "none", maxOutputTokens: 2_000, structuredOutput: true, retryable: true, useWebSearch: true },
  generate_landing: { model: CONTENT, reasoningEffort: "medium", maxOutputTokens: 10_000, structuredOutput: true, retryable: true, useWebSearch: true },
  generate_quick_material: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 10_000, structuredOutput: true, retryable: true, useWebSearch: true },
  // adapt_text spans 12 KLIO editor goals with very different weight
  // (proofread vs. full SEO rebuild) — the route picks reasoningEffort
  // per goal (see adaptationReasoningEffort below); this entry is the
  // fallback/default for the majority of goals (rewrite, shorten, tone…).
  adapt_text: { model: CONTENT, reasoningEffort: "none", maxOutputTokens: 6_000, structuredOutput: true, retryable: true, useWebSearch: false },
  generate_content_plan: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 18_000, structuredOutput: true, retryable: true, useWebSearch: true },
  // Up to 5 selected topics x 3 full alternatives each, each a complete
  // plan row (structure, lsi, evidence, sources...) — genuinely needs the
  // same ceiling as a fresh content plan, not the generic "small patch"
  // budget most other revise_* operations get.
  revise_content_plan: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 12_000, structuredOutput: true, retryable: true, useWebSearch: false },
  // Deviation from the spec's illustrative list (which puts keyword
  // extraction on nano): KLIO's semantics module does web-search-driven
  // *research* of 18-30 novel query phrases from a bare topic, not
  // extraction from a given text. That's a creative/reasoning task nano
  // is too weak for at useful quality — verified this session: nano/mini-
  // tier models either time out on it or degrade to near-brand-only
  // phrases. Kept on Luna.
  research_semantics: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 9_000, structuredOutput: true, retryable: true, useWebSearch: false },
  discover_competitors: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 1_800, structuredOutput: false, retryable: true, useWebSearch: true },
  analyze_competitors: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 9_000, structuredOutput: true, retryable: true, useWebSearch: false },
  // The correction/patch pass (missing keyword, off-target length, etc.):
  // always a small, targeted rewrite of an already-generated draft, never
  // a fresh full generation.
  revise_content: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 12_000, structuredOutput: true, retryable: false, useWebSearch: false },
  // Reads one site (already fetched server-side by readWebsiteContext) and
  // distills it into 4 short profile fields — small output, but genuinely
  // needs judgement (what's the real positioning vs. marketing filler,
  // which facts are actually verifiable) rather than mechanical extraction,
  // so this stays on Luna like the other research_* operations rather than
  // nano. web_search stays on as a fallback for when the fetched page is
  // thin or unreadable (SPA, blocked, etc.) — the model can still ground
  // itself in public information about the company instead of guessing.
  analyze_brand_website: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 3_500, structuredOutput: true, retryable: true, useWebSearch: true },

  normalize_quick_brief: { model: UTILITY, reasoningEffort: "none", maxOutputTokens: 800, structuredOutput: true, retryable: true, useWebSearch: false },
  validate_content: { model: UTILITY, reasoningEffort: "none", maxOutputTokens: 1_500, structuredOutput: true, retryable: true, useWebSearch: false },
  // Shrinks an already-written, still-too-long article down to its target
  // length while keeping the argument intact — the rare last-resort case
  // where the initial generation *and* the one revise_content correction
  // pass both still overshot. This is condensing existing text to a
  // length constraint, not composing new prose, so it's in nano's range;
  // a purely mechanical word-count cut (see trimOverflowBody in
  // generate/route.ts) is kept only as the fallback if this call fails.
  condense_overflow: { model: UTILITY, reasoningEffort: "none", maxOutputTokens: 8_000, structuredOutput: true, retryable: true, useWebSearch: false },
};

// adapt_text's 12 KLIO editor goals (see app/content-plans.ts
// ADAPTATION_PLANS) don't share one reasoning weight — a spelling pass
// and a full SEO rebuild are not the same amount of work.
const ADAPT_GOAL_REASONING: Record<string, ReasoningEffort> = {
  proofread: "none",
  clarity: "none",
  shorten: "none",
  opening: "none",
  closing: "none",
  social: "none",
  ads: "none",
  cold_email: "none",
  rewrite: "low",
  review: "low",
  landing: "low",
  seo: "low",
};

export function adaptationReasoningEffort(goal: string): ReasoningEffort {
  return ADAPT_GOAL_REASONING[goal] ?? "none";
}
