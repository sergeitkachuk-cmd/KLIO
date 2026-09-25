import { getDb } from "../../../db";
import { aiUsage } from "../../../db/schema";

export type ImageUsageOperation = "generate_image" | "generate_carousel_image";

/** Image requests use a separate provider path from the text AI router.
 * Record their outcome in the same admin activity log, without pretending
 * image requests have text tokens or known per-request pricing. */
export async function recordImageUsage(input: {
  ownerEmail: string;
  requestId: string;
  operation: ImageUsageOperation;
  durationMs: number;
  status: "success" | "failed";
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
      model: process.env.KLIO_IMAGE_MODEL?.trim() || "image-provider",
      reasoningEffort: "none",
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
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
