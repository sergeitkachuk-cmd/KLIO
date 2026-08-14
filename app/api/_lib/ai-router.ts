import { getDb } from "../../../db";
import { aiUsage } from "../../../db/schema";
import {
  activeProvider,
  AI_MODELS,
  FALLBACKS,
  OPERATION_CONFIG,
  PROVIDER_API_KEY_ENV,
  estimateCostUsd,
  type AiModelId,
  type AiOperation,
  type ReasoningEffort,
} from "./ai-config";

// Both providers speak (as far as their docs claim — verify against a real
// key before fully trusting it) the same Responses API shape: model/input/
// instructions/tools/reasoning/text, output_text or output[].content[].text
// in the response, usage.input_tokens/output_tokens. That's why requestOnce
// only branches on endpoint + api key below instead of needing a second
// parser.
const PROVIDER_ENDPOINTS: Record<ReturnType<typeof activeProvider>, string> = {
  openai: "https://api.openai.com/v1/responses",
  deepseek: "https://api.deepseek.com/v1/responses",
};

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
  // Only "message" items hold the model's actual answer — everything else
  // in this array (reasoning, web_search_call, function_call...) is the
  // model's own intermediate work, walked through in order before the
  // final message. DeepSeek's reasoning items populate a real, non-empty
  // content[].text (reasoning_text) — unlike OpenAI's, which leaves this
  // empty — so without filtering by item type, the loop below would grab
  // that reasoning narration instead of waiting for the final answer.
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "message") continue;
    const content = Array.isArray(record.content) ? record.content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === "refusal") return { text: "", refused: true };
      if (typeof partRecord.text === "string" && partRecord.text.trim()) return { text: partRecord.text.trim(), refused: false };
    }
  }
  return { text: "", refused: false };
}

// Compact, unbounded-safe summary of response.output for the diagnostic
// logs below — "reasoning:completed, web_search_call:completed,
// message:completed" etc. A single verbose reasoning_text block (seen in
// production: dozens of brainstormed topic candidates, easily 5-10k
// characters on its own) can by itself blow through the truncated
// diagnostic dump's budget before it ever reaches whether a message item
// existed later in the array — this line answers that question first,
// in a couple hundred characters, regardless of how long the reasoning
// content is.
function summarizeOutputItems(output: unknown): string {
  if (!Array.isArray(output)) return "(not an array)";
  return output.map((item) => {
    if (!item || typeof item !== "object") return "?";
    const record = item as Record<string, unknown>;
    return `${record.type ?? "?"}:${record.status ?? "?"}`;
  }).join(", ") || "(empty)";
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
  const provider = activeProvider();
  const apiKey = process.env[PROVIDER_API_KEY_ENV[provider]]?.trim();
  if (!apiKey) {
    const error = new AiCallError(`ИИ пока не подключён. Добавьте ${PROVIDER_API_KEY_ENV[provider]} на сервере.`, 503);
    (error as { configError?: boolean }).configError = true;
    throw error;
  }

  const response = await fetch(PROVIDER_ENDPOINTS[provider], {
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
    throw new AiCallError("Ошибка авторизации в AI API.", response.status);
  }
  if (response.status === 429) {
    const detail = await response.text();
    const error = new AiCallError("Превышен лимит запросов к ИИ.", 429);
    (error as { transient?: boolean }).transient = true;
    console.error(`${provider} rate limited`, detail.slice(0, 500));
    throw error;
  }
  if (!response.ok) {
    const detail = await response.text();
    console.error(`${provider} request failed`, response.status, detail.slice(0, 1200));
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
    // This branch had no diagnostics at all until a real "AI-редакция
    // вернула пустой ответ" on DeepSeek (confirmed provider — see
    // AI_PROVIDER) couldn't be explained from logs: was output[] genuinely
    // empty, stuck on an unfinished tool call, cut off by the token
    // budget, or something else entirely (a provider-side error the
    // status-code checks above didn't catch)? Same diagnostic shape as
    // the unparseable-JSON branch below, minus `text` itself since
    // there's none to log here.
    console.error(`${provider} returned no text output for a text-expecting response`);
    const diagnostic = body && typeof body === "object" ? body as Record<string, unknown> : {};
    console.error(`${provider} output item summary`, summarizeOutputItems(diagnostic.output));
    console.error(`${provider} response diagnostic`, JSON.stringify({
      status: diagnostic.status,
      incomplete_details: diagnostic.incomplete_details,
      error: diagnostic.error,
      output: diagnostic.output,
    }).slice(0, 6000));
    const error = new AiCallError("AI-редакция вернула пустой ответ.", 502);
    (error as { transient?: boolean }).transient = true;
    throw error;
  }

  if (!params.structuredOutput) return { raw: text, usage, body };
  try {
    return { parsed: JSON.parse(extractJsonPayload(text)), usage, body };
  } catch {
    // Unlike OpenAI's strict json_schema mode, DeepSeek's JSON output isn't
    // schema-enforced (per their docs — only response_format: json_object,
    // no strict mode) — logging the raw text alone wasn't enough to explain
    // a case where outputText() extracted reasoning/tool-planning narration
    // instead of the final answer, so log the full response body too: that
    // shows whether DeepSeek's output[] shape (item "type"s, a separate
    // reasoning block, an unfinished tool call, a "status" other than
    // "completed", etc.) actually differs from what outputText() assumes.
    console.error(`${provider} returned unparseable structured output`, text.slice(0, 1500));
    // Logging the whole body wasted the budget re-echoing our own
    // instructions/input back — the response always includes those. Log
    // only the parts that actually explain what happened: status/
    // incomplete_details/error (truncation vs. genuine completion) and the
    // output[] array itself (tool-call items vs. message items, in what
    // order — that's what outputText() needs to walk correctly).
    const diagnostic = body && typeof body === "object" ? body as Record<string, unknown> : {};
    console.error(`${provider} output item summary`, summarizeOutputItems(diagnostic.output));
    console.error(`${provider} response diagnostic`, JSON.stringify({
      status: diagnostic.status,
      incomplete_details: diagnostic.incomplete_details,
      error: diagnostic.error,
      output: diagnostic.output,
    }).slice(0, 6000));
    const error = new AiCallError("AI-редакция вернула неполный структурированный ответ.", 502);
    (error as { invalidOutput?: boolean }).invalidOutput = true;
    throw error;
  }
}

// Strips a ```json ... ``` (or bare ``` ... ```) fence some models wrap
// structured output in even when told not to, plus any leading/trailing
// prose outside the outermost {...} — before falling back to the raw text
// as-is. Harmless no-op for already-clean JSON (OpenAI's case today).
function extractJsonPayload(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return candidate;
  return candidate.slice(start, end + 1);
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
      // Note: a genuine transient 503 from OpenAI (server.status >= 500 in
      // requestOnce) also carries status 503, but only the missing-API-key
      // case is marked configError — that's the only 503 that should skip
      // retry/fallback outright.
      const isAuthOrConfig = error instanceof AiCallError
        && (error.status === 401 || error.status === 403 || (error.status === 503 && (error as { configError?: boolean }).configError === true));
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
