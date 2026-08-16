// Single source of truth for KLIO's AI routing: which model handles which
// operation, at what reasoning effort, with what output budget. Nothing
// outside this file should hardcode a model id, a reasoning effort level,
// or a price — see ai-router.ts for the call site that reads this config,
// and every app/api/*/route.ts for the operations that use it.

export type AiProvider = "openai" | "deepseek";

// One env var switches every operation at once — see ai-router.ts's
// requestOnce for the actual per-provider HTTP call. Defaults to openai so
// an unset/misspelled value never silently changes behavior in production.
export function activeProvider(): AiProvider {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "deepseek" ? "deepseek" : "openai";
}

export const PROVIDER_API_KEY_ENV: Record<AiProvider, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

// Single check for "/api/ai-status" and anywhere else that only needs a
// yes/no — ai-router.ts reads PROVIDER_API_KEY_ENV directly since it also
// needs the env var's name for its error message.
export function aiConfigured(): boolean {
  return Boolean(process.env[PROVIDER_API_KEY_ENV[activeProvider()]]?.trim());
}

const OPENAI_MODELS = {
  // Full-tier model: everything the visitor directly reads or publishes —
  // articles, posts, ads, landing copy, content plans, editor rewrites,
  // competitor analysis, semantic research.
  CONTENT: "gpt-5.6-luna",
  // Small/fast model: short, formalized, non-creative steps — parsing a
  // freeform brief into structured fields, a semantic QA pass over an
  // already-written draft. Never used to produce user-facing prose.
  UTILITY: "gpt-5.4-nano",
} as const;

const DEEPSEEK_MODELS = {
  CONTENT: "deepseek-v4-pro",
  UTILITY: "deepseek-v4-flash",
} as const;

// Resolved once per process start from AI_PROVIDER. Every OPERATION_CONFIG
// entry below is written against AI_MODELS.CONTENT/UTILITY, never a literal
// model id, so switching provider is one env var and a redeploy — not a
// code change, and the OpenAI path stays intact as a fallback if DeepSeek
// turns out to have problems.
export const AI_MODELS = activeProvider() === "deepseek" ? DEEPSEEK_MODELS : OPENAI_MODELS;

export type AiModelId =
  | (typeof OPENAI_MODELS)[keyof typeof OPENAI_MODELS]
  | (typeof DEEPSEEK_MODELS)[keyof typeof DEEPSEEK_MODELS];

// If UTILITY is unavailable, a *retryable* short task may run on CONTENT
// once its own retries are exhausted (recorded as a fallback in ai_usage).
// CONTENT has no fallback: a full article is never silently downgraded to
// the utility model. Fallback never crosses providers — different API key,
// different endpoint.
export const FALLBACKS: Record<AiModelId, AiModelId | null> = {
  "gpt-5.4-nano": "gpt-5.6-luna",
  "gpt-5.6-luna": null,
  "deepseek-v4-flash": "deepseek-v4-pro",
  "deepseek-v4-pro": null,
};

type ModelPricing = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  // DeepSeek only: peak-hour rates apply 01:00-04:00 and 06:00-10:00 UTC
  // (roughly double off-peak) — see isDeepSeekPeakHour below. Absent for
  // OpenAI models, which don't vary by time of day.
  peak?: { inputPerMillion: number; cachedInputPerMillion: number; outputPerMillion: number };
};

export const MODEL_PRICING: Record<AiModelId, ModelPricing> = {
  "gpt-5.6-luna": { inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 6 },
  "gpt-5.4-nano": { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 },
  // Rates effective 2026-08-16 16:00 UTC (DeepSeek's move to peak/off-peak
  // billing) — see https://api-docs.deepseek.com/quick_start/pricing.
  "deepseek-v4-pro": {
    inputPerMillion: 0.66, cachedInputPerMillion: 0.022, outputPerMillion: 1.98,
    peak: { inputPerMillion: 1.32, cachedInputPerMillion: 0.044, outputPerMillion: 3.96 },
  },
  "deepseek-v4-flash": {
    inputPerMillion: 0.22, cachedInputPerMillion: 0.007, outputPerMillion: 0.66,
    peak: { inputPerMillion: 0.44, cachedInputPerMillion: 0.014, outputPerMillion: 1.32 },
  },
};

function isDeepSeekPeakHour(date: Date): boolean {
  const hour = date.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export function estimateCostUsd(model: AiModelId, usage: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}, at: Date = new Date()): number {
  const base = MODEL_PRICING[model];
  const pricing = base.peak && isDeepSeekPeakHour(at) ? base.peak : base;
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
  // Full materials are grounded by one bounded Tavily request in the route,
  // not by a model-owned web tool. DeepSeek can otherwise spend minutes in
  // search/tool loops before it starts writing; a single compact digest keeps
  // the facts while making generation a single predictable model pass.
  generate_seo_article: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 10_000, structuredOutput: true, retryable: true, useWebSearch: false },
  generate_social_post: { model: CONTENT, reasoningEffort: "none", maxOutputTokens: 2_500, structuredOutput: true, retryable: true, useWebSearch: false },
  generate_ad_copy: { model: CONTENT, reasoningEffort: "none", maxOutputTokens: 2_000, structuredOutput: true, retryable: true, useWebSearch: false },
  generate_landing: { model: CONTENT, reasoningEffort: "low", maxOutputTokens: 10_000, structuredOutput: true, retryable: true, useWebSearch: false },
  generate_quick_material: { model: CONTENT, reasoningEffort: "none", maxOutputTokens: 6_000, structuredOutput: true, retryable: true, useWebSearch: false },
  // adapt_text spans 12 KLIO editor goals with very different weight
  // (proofread vs. full SEO rebuild) — the route picks reasoningEffort
  // per goal (see adaptationReasoningEffort below); this entry is the
  // fallback/default for the majority of goals (rewrite, shorten, tone…).
  adapt_text: { model: CONTENT, reasoningEffort: "none", maxOutputTokens: 6_000, structuredOutput: true, retryable: true, useWebSearch: false },
  // Long fix history compressed to the point that matters (git blame has
  // the rest if it's ever needed): every failure chased on this operation
  // — a reasoning item draft-rejecting-redrafting its own topic list for
  // several turns, then (once reasoning was turned off to stop that) 10
  // web_search_call rounds narrated with commentary text instead of ever
  // finishing — is DeepSeek-specific behavior. Routing this operation to
  // OpenAI instead was tried and reverted the same session: KLIO moved to
  // DeepSeek specifically so the app doesn't depend on OpenAI, which is
  // unreliable to reach from Russia without a VPN — not a lever available
  // here at all, regardless of what it might have fixed. Token-budget and
  // existingTitles-length tweaks along the way helped a little but never
  // fixed the actual runaway; a separate research call (any provider) for
  // extra grounding beyond the brand's own site added a full sequential
  // round-trip that measurably slowed things down (10 topics ~2min, 13
  // topics ~3min) for a quality gain the site owner judged not worth it.
  //
  // What actually stuck: reasoningEffort "none" and useWebSearch false —
  // no search tool or reasoning scratchpad left for the model to get lost
  // in, composing topics from the profile/semantics/geography already in
  // the request plus the brand's website (readWebsiteContext in content-
  // plan/route.ts — a direct HTTP read, not an AI call, so it doesn't
  // share any of this operation's reliability problems).
  // A failed long generation can still have consumed a very large cached
  // prompt at the provider. Do not automatically replay this operation:
  // the user can explicitly retry after seeing the error, while automatic
  // retries turn one malformed/empty provider response into several full
  // billed requests.
  generate_content_plan: { model: CONTENT, reasoningEffort: "none", maxOutputTokens: 18_000, structuredOutput: true, retryable: false, useWebSearch: false },
  // Up to 5 selected topics x 3 full alternatives each, each a complete
  // plan row (structure, lsi, evidence, sources...) — genuinely needs a
  // ceiling close to a fresh content plan's, not the generic "small
  // patch" budget most other revise_* operations get. Reverted alongside
  // generate_content_plan above — same reasoning: no web search here to
  // run away with the budget, so the original ceiling was never actually
  // the problem.
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

// adapt_text's 14 KLIO editor goals (see app/content-plans.ts
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
  // Mechanical restyling of an existing draft — same weight as shorten/social.
  change_tone: "none",
  // One bounded web digest is supplied by the route; the model itself has
  // no search tool and therefore cannot enter a tool loop.
  deepen: "low",
  rewrite: "low",
  review: "low",
  landing: "low",
  seo: "low",
  // Judgement call (match lexicon/rhythm to the brand profile without
  // inventing voice from an empty one) comparable to rewrite/review.
  brand_voice: "low",
};

export function adaptationReasoningEffort(goal: string): ReasoningEffort {
  return ADAPT_GOAL_REASONING[goal] ?? "none";
}
