import { getDb } from "../../../db";
import { aiUsage } from "../../../db/schema";
import {
  AI_MODELS,
  FALLBACKS,
  OPERATION_CONFIG,
  estimateCostUsd,
  type AiModelId,
  type AiOperation,
  type ReasoningEffort,
} from "./ai-config";

export class AiCallError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

type CallAiModelInput = {
  operation: AiOperation;
  instructions: string;
  input: string;
  // Structured-output schema. Required when the operation's config sets
  // structuredOutput: true.
  schemaName?: string;
  schema?: Record<string, unknown>;
  // adapt_text overrides reasoning per KLIO editor goal — see
  // adaptationReasoningEffort() in ai-config.ts.
  reasoningEffortOverride?: ReasoningEffort;
  // discover_competitors forces an actual web_search tool call and needs
  // the raw citations/annotations back — see toolChoice/includeSources
  // below and rawResponse on the result.
  toolChoice?: "required";
  includeSources?: boolean;
  // For ai_usage accounting only — never sent to OpenAI.
  ownerEmail?: string;
  brandId?: string;
  materialId?: string;
};

type CallAiModelResult<T> = {
  result: T;
  model: AiModelId;
  // Full Responses API body for the winning attempt — only routes that
  // need more than the extracted text/JSON (e.g. discover_competitors
  // reading url_citation annotations) should use this.
  rawResponse: unknown;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    retryCount: number;
    requestId: string | null;
  };
};

function outputText(response: unknown): { text: string; refused: boolean } {
  const source = response && typeof response === "object" ? response as Record<string, unknown> : {};
  if (typeof source.output_text === "string" && source.output_text.trim()) {
    return { text: source.output_text.trim(), refused: false };
  }
  const output = Array.isArray(source.output) ? source.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (record.type === "refusal") return { text: "", refused: true };
      if (typeof record.text === "string" && record.text.trim()) return { text: record.text.trim(), refused: false };
    }
  }
  return { text: "", refused: false };
}

function extractUsage(response: unknown) {
  const source = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const usage = source.usage && typeof source.usage === "object" ? source.usage as Record<string, unknown> : {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : inputTokens + outputTokens;
  const details = usage.input_tokens_details && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details as Record<string, unknown>
    : {};
  const cachedInputTokens = typeof details.cached_tokens === "number" ? details.cached_tokens : 0;
  const requestId = typeof source.id === "string" ? source.id : null;
  return { inputTokens, outputTokens, totalTokens, cachedInputTokens, requestId };
}

function sleep(ms: number) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function logUsage(row: {
  ownerEmail: string;
  brandId?: string;
  materialId?: string;
  operation: AiOperation;
  model: AiModelId;
  reasoningEffort: ReasoningEffort;
  usage: ReturnType<typeof extractUsage>;
  durationMs: number;
  retryCount: number;
  status: "success" | "failed";
  fallbackFrom?: AiModelId;
  errorMessage?: string;
}) {
  if (!process.env.DATABASE_URL?.trim()) return;
  try {
    const db = getDb();
    await db.insert(aiUsage).values({
      id: crypto.randomUUID(),
      ownerEmail: row.ownerEmail,
      brandId: row.brandId ?? null,
      materialId: row.materialId ?? null,
      operation: row.operation,
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      inputTokens: row.usage.inputTokens,
      cachedInputTokens: row.usage.cachedInputTokens,
      outputTokens: row.usage.outputTokens,
      totalTokens: row.usage.totalTokens,
      estimatedCostUsd: estimateCostUsd(row.model, row.usage),
      durationMs: row.durationMs,
      retryCount: row.retryCount,
      status: row.status,
      fallbackFrom: row.fallbackFrom ?? null,
      requestId: row.usage.requestId,
      errorMessage: row.errorMessage?.slice(0, 500) ?? null,
    });
  } catch (error) {
    // Usage accounting must never break the actual AI call.
    console.error("Failed to record ai_usage row", error);
  }
}

// Single call to the OpenAI Responses API for one attempt — no retry/
// fallback logic here, that lives in callAiModel below.
async function requestOnce(params: {
  model: AiModelId;
  reasoningEffort: ReasoningEffort;
  maxOutputTokens: number;
  structuredOutput: boolean;
  useWebSearch: boolean;
  schemaName?: string;
  schema?: Record<string, unknown>;
  instructions: string;
  input: string;
  toolChoice?: "required";
  includeSources?: boolean;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AiCallError("ИИ пока не подключён. Добавьте OPENAI_API_KEY на сервере.", 503);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      store: false,
      reasoning: { effort: params.reasoningEffort },
      max_output_tokens: params.maxOutputTokens,
      ...(params.useWebSearch ? { tools: [{ type: "web_search", search_context_size: "medium" }] } : {}),
      ...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
      ...(params.includeSources ? { include: ["web_search_call.action.sources"] } : {}),
      ...(params.structuredOutput
        ? { text: { verbosity: "medium", format: { type: "json_schema", name: params.schemaName, strict: true, schema: params.schema } } }
        : { text: { verbosity: "medium" } }),
      instructions: params.instructions,
      input: params.input,
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new AiCallError("Ошибка авторизации в OpenAI API.", response.status);
  }
  if (response.status === 429) {
    const detail = await response.text();
    const error = new AiCallError("Превышен лимит запросов к OpenAI.", 429);
    (error as { transient?: boolean }).transient = true;
    console.error("OpenAI rate limited", detail.slice(0, 500));
    throw error;
  }
  if (!response.ok) {
    const detail = await response.text();
    console.error("OpenAI request failed", response.status, detail.slice(0, 1200));
    const transient = response.status >= 500;
    const error = new AiCallError("AI-редакция временно не ответила.", response.status);
    (error as { transient?: boolean }).transient = transient;
    throw error;
  }

  const body = await response.json();
  const usage = extractUsage(body);
  const { text, refused } = outputText(body);
  if (refused) throw new AiCallError("AI-редакция не смогла выполнить этот запрос. Измените формулировку.", 422);
  if (!text) {
    const error = new AiCallError("AI-редакция вернула пустой ответ.", 502);
    (error as { transient?: boolean }).transient = true;
    throw error;
  }

  if (!params.structuredOutput) return { raw: text, usage, body };
  try {
    return { parsed: JSON.parse(text), usage, body };
  } catch {
    const error = new AiCallError("AI-редакция вернула неполный структурированный ответ.", 502);
    (error as { invalidOutput?: boolean }).invalidOutput = true;
    throw error;
  }
}

// The router entry point every AI-calling route should go through. Looks
// up the operation's model/reasoning/token budget from ai-config.ts,
// applies retry policy (2x for transient API errors, 1x for invalid
// structured output), falls back UTILITY -> CONTENT once nano's own
// retries are exhausted (never the reverse), and records a usage row.
export async function callAiModel<T = Record<string, unknown>>(
  params: CallAiModelInput,
): Promise<CallAiModelResult<T>> {
  const config = OPERATION_CONFIG[params.operation];
  const reasoningEffort = params.reasoningEffortOverride ?? config.reasoningEffort;
  const startedAt = Date.now();

  let attemptModel = config.model;
  let transientRetries = 0;
  let invalidOutputRetries = 0;
  let fallbackFrom: AiModelId | undefined;
  let lastError: unknown;

  // Generous but finite: at most 2 transient retries + 1 fallback attempt
  // + 1 invalid-output retry, never an unbounded loop.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const outcome = await requestOnce({
        model: attemptModel,
        reasoningEffort,
        maxOutputTokens: config.maxOutputTokens,
        structuredOutput: config.structuredOutput,
        useWebSearch: config.useWebSearch,
        schemaName: params.schemaName,
        schema: params.schema,
        instructions: params.instructions,
        input: params.input,
        toolChoice: params.toolChoice,
        includeSources: params.includeSources,
      });

      if (params.ownerEmail) {
        void logUsage({
          ownerEmail: params.ownerEmail,
          brandId: params.brandId,
          materialId: params.materialId,
          operation: params.operation,
          model: attemptModel,
          reasoningEffort,
          usage: outcome.usage,
          durationMs: Date.now() - startedAt,
          retryCount: transientRetries + invalidOutputRetries,
          status: "success",
          fallbackFrom,
        });
      }

      return {
        result: (config.structuredOutput ? outcome.parsed : { raw: outcome.raw }) as T,
        model: attemptModel,
        rawResponse: outcome.body,
        usage: {
          inputTokens: outcome.usage.inputTokens,
          cachedInputTokens: outcome.usage.cachedInputTokens,
          outputTokens: outcome.usage.outputTokens,
          totalTokens: outcome.usage.totalTokens,
          durationMs: Date.now() - startedAt,
          retryCount: transientRetries + invalidOutputRetries,
          requestId: outcome.usage.requestId,
        },
      };
    } catch (error) {
      lastError = error;
      const isTransient = error instanceof AiCallError && (error as { transient?: boolean }).transient;
      const isInvalidOutput = error instanceof AiCallError && (error as { invalidOutput?: boolean }).invalidOutput;
      const isAuthOrConfig = error instanceof AiCallError && (error.status === 401 || error.status === 403 || error.status === 503);
      // Auth/config errors (bad key, missing key) never retry or fall back.
      if (isAuthOrConfig) break;

      if (isTransient && config.retryable && transientRetries < 2) {
        transientRetries += 1;
        await sleep(400 * 2 ** transientRetries);
        continue;
      }

      if (isInvalidOutput && invalidOutputRetries < 1) {
        invalidOutputRetries += 1;
        continue;
      }

      // Exhausted this model's own retries. Nano may fall back to Luna
      // once; Luna never falls back anywhere.
      const fallback = FALLBACKS[attemptModel];
      if (fallback && fallback !== attemptModel && !fallbackFrom) {
        fallbackFrom = attemptModel;
        attemptModel = fallback;
        continue;
      }

      break;
    }
  }

  if (params.ownerEmail) {
    void logUsage({
      ownerEmail: params.ownerEmail,
      brandId: params.brandId,
      materialId: params.materialId,
      operation: params.operation,
      model: attemptModel,
      reasoningEffort,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, requestId: null },
      durationMs: Date.now() - startedAt,
      retryCount: transientRetries + invalidOutputRetries,
      status: "failed",
      fallbackFrom,
      errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }

  if (lastError instanceof AiCallError) throw lastError;
  throw new AiCallError("Не удалось получить ответ от ИИ. Попробуйте ещё раз.", 502);
}

export { AI_MODELS };
