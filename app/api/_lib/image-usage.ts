import { getDb } from "../../../db";
import { aiUsage } from "../../../db/schema";
import type { ImageProviderUsage } from "./image-cost";

export type ImageUsageOperation = "generate_image" | "generate_carousel_image";

/** Image requests use a separate provider path from the text AI router. */
export async function recordImageUsage(input: {
  ownerEmail: string;
  requestId: string;
  operation: ImageUsageOperation;
  durationMs: number;
  status: "success" | "failed";
  usage?: ImageProviderUsage;
  errorMessage?: string;
}) {
  if (!process.env.DATABASE_URL?.trim()) return;
  try {
    await getDb().insert(aiUsage).values({
      id: crypto.randomUUID(),
      ownerEmail: input.ownerEmail,
      brandId: null,
      materialId: null,
      operation: input.operation,
      model: input.usage?.model || process.env.KLIO_IMAGE_MODEL?.trim() || "image-provider",
      reasoningEffort: "none",
      inputTokens: input.usage?.inputTokens ?? 0,
      cachedInputTokens: input.usage?.cachedInputTokens ?? 0,
      outputTokens: input.usage?.outputTokens ?? 0,
      totalTokens: input.usage?.totalTokens ?? 0,
      estimatedCostUsd: input.usage?.estimatedCostUsd ?? 0,
      costSource: input.usage?.costSource ?? "unknown",
      durationMs: Math.max(0, Math.round(input.durationMs)),
      retryCount: 0,
      status: input.status,
      fallbackFrom: null,
      requestId: input.requestId,
      errorMessage: input.errorMessage?.slice(0, 500) ?? null,
    });
  } catch (error) {
    // Diagnostics must not turn an otherwise completed generation into a
    // failed one if the usage log is temporarily unavailable.
    console.error("Failed to record image usage", error);
  }
}
