/**
 * Image usage accounting is kept separate from the database writer so the
 * provider response can be normalized and tested without opening a database
 * connection. OpenAI may return token usage for image requests, but a relay
 * or a streaming response can omit it; the latter is deliberately marked as
 * an estimate instead of being presented as an exact provider charge.
 */

export type ImageUsageCostSource = "provider" | "estimate" | "unknown";

export type ImageProviderUsage = {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputImageTokens: number;
  inputTextTokens: number;
  outputImageTokens: number;
  outputTextTokens: number;
  estimatedCostUsd: number;
  costSource: ImageUsageCostSource;
};

// GPT Image 2.5 Flare pricing, USD per million tokens. The provider's
// response is always preferred; these rates are only used when a response
// contains usage but not a more specific token breakdown.
const PRICE_PER_MILLION = {
  imageInput: 8,
  cachedImageInput: 2,
  textInput: 5,
  imageOutput: 30,
  textOutput: 5,
} as const;

function nonNegative(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function tokenCost(input: {
  inputImageTokens: number;
  cachedInputTokens: number;
  inputTextTokens: number;
  outputImageTokens: number;
  outputTextTokens: number;
}): number {
  const cachedImageTokens = Math.min(input.cachedInputTokens, input.inputImageTokens);
  const uncachedImageTokens = Math.max(0, input.inputImageTokens - cachedImageTokens);
  return (
    (uncachedImageTokens / 1_000_000) * PRICE_PER_MILLION.imageInput
    + (cachedImageTokens / 1_000_000) * PRICE_PER_MILLION.cachedImageInput
    + (input.inputTextTokens / 1_000_000) * PRICE_PER_MILLION.textInput
    + (input.outputImageTokens / 1_000_000) * PRICE_PER_MILLION.imageOutput
    + (input.outputTextTokens / 1_000_000) * PRICE_PER_MILLION.textOutput
  );
}

function estimatedOutputTokens(size: string, quality: string, partialImages: number): number {
  const [width, height] = size.match(/^([0-9]+)x([0-9]+)$/)?.slice(1).map(Number) ?? [1024, 1024];
  const areaScale = Math.max(1, (width * height) / (1024 * 1024));
  const qualityScale: Record<string, number> = { low: 0.6, medium: 0.8, high: 1, xhigh: 1.2, max: 1.35 };
  const base = 1_800 * areaScale * (qualityScale[quality] ?? qualityScale.max);
  // The image API documents 100 output image tokens for each partial image.
  return Math.max(1, Math.round(base + Math.max(0, partialImages) * 100));
}

/** Normalize a provider `usage` object, or produce a visibly labelled estimate. */
export function normalizeImageUsage(raw: unknown, options: {
  model: string;
  promptCharacters?: number;
  referenceImageCount?: number;
  size?: string;
  quality?: string;
  partialImages?: number;
}): ImageProviderUsage {
  const usage = record(raw);
  const inputDetails = record(usage.input_tokens_details);
  const outputDetails = record(usage.output_tokens_details);
  const hasProviderUsage = Object.keys(usage).length > 0 && (
    usage.input_tokens !== undefined || usage.output_tokens !== undefined || usage.total_tokens !== undefined
  );
  if (hasProviderUsage) {
    const inputTokens = nonNegative(usage.input_tokens);
    const cachedInputTokens = nonNegative(inputDetails.cached_tokens);
    const outputTokens = nonNegative(usage.output_tokens);
    const totalTokens = nonNegative(usage.total_tokens) || inputTokens + outputTokens;
    const inputTextTokens = nonNegative(inputDetails.text_tokens);
    const inputImageTokens = nonNegative(inputDetails.image_tokens) || Math.max(0, inputTokens - inputTextTokens);
    const outputTextTokens = nonNegative(outputDetails.text_tokens);
    const outputImageTokens = nonNegative(outputDetails.image_tokens) || Math.max(0, outputTokens - outputTextTokens);
    return {
      model: options.model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens,
      inputImageTokens,
      inputTextTokens,
      outputImageTokens,
      outputTextTokens,
      estimatedCostUsd: tokenCost({ inputImageTokens, cachedInputTokens, inputTextTokens, outputImageTokens, outputTextTokens }),
      costSource: "provider",
    };
  }

  const inputTextTokens = Math.max(1, Math.ceil(Math.max(0, options.promptCharacters ?? 0) / 4));
  const inputImageTokens = Math.max(0, options.referenceImageCount ?? 0) * 1_024;
  const outputImageTokens = estimatedOutputTokens(options.size ?? "1024x1024", options.quality ?? "max", options.partialImages ?? 0);
  const inputTokens = inputTextTokens + inputImageTokens;
  const outputTokens = outputImageTokens;
  return {
    model: options.model,
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputImageTokens,
    inputTextTokens,
    outputImageTokens,
    outputTextTokens: 0,
    estimatedCostUsd: tokenCost({ inputImageTokens, cachedInputTokens: 0, inputTextTokens, outputImageTokens, outputTextTokens: 0 }),
    costSource: "estimate",
  };
}

export function aggregateImageUsages(usages: ImageProviderUsage[], model = "image-provider"): ImageProviderUsage {
  if (!usages.length) return {
    model,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputImageTokens: 0,
    inputTextTokens: 0,
    outputImageTokens: 0,
    outputTextTokens: 0,
    estimatedCostUsd: 0,
    costSource: "unknown",
  };
  const total = usages.reduce((sum, usage) => ({
    inputTokens: sum.inputTokens + usage.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + usage.cachedInputTokens,
    outputTokens: sum.outputTokens + usage.outputTokens,
    totalTokens: sum.totalTokens + usage.totalTokens,
    inputImageTokens: sum.inputImageTokens + usage.inputImageTokens,
    inputTextTokens: sum.inputTextTokens + usage.inputTextTokens,
    outputImageTokens: sum.outputImageTokens + usage.outputImageTokens,
    outputTextTokens: sum.outputTextTokens + usage.outputTextTokens,
    estimatedCostUsd: sum.estimatedCostUsd + usage.estimatedCostUsd,
  }), {
    inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0,
    inputImageTokens: 0, inputTextTokens: 0, outputImageTokens: 0, outputTextTokens: 0,
    estimatedCostUsd: 0,
  });
  return {
    model: usages.every((usage) => usage.model === usages[0].model) ? usages[0].model : model,
    ...total,
    costSource: usages.every((usage) => usage.costSource === "provider")
      ? "provider"
      : usages.some((usage) => usage.costSource !== "unknown") ? "estimate" : "unknown",
  };
}
