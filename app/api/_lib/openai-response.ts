// This file used to also hold requestStructuredJson()/openAiConfiguration()
// — a second, parallel place that picked an OpenAI model and called the
// Responses API directly. Every route has since moved onto the single
// router in ai-router.ts / ai-config.ts, so that duplicate call path was
// removed. What's left is shared error plumbing: the error types and the
// one openAiErrorResponse() mapper every AI-calling route's catch-all uses,
// for both legacy AiResponseError throws (still used for post-call
// validation, e.g. semantics/content-plan schema checks) and AiCallError
// from callAiModel().
import { AiCallError } from "./ai-router";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ИИ пока не подключён. Демонстрационные ответы отключены, чтобы КЛИО не подменяла вашу тему шаблонным текстом.");
  }
}

export class AiResponseError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function openAiErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AiNotConfiguredError) {
    return Response.json({ error: error.message, code: "AI_NOT_CONFIGURED" }, { status: 503 });
  }
  if (error instanceof AiResponseError) {
    return Response.json({ error: error.message, code: "AI_RESPONSE_ERROR" }, { status: error.status });
  }
  // Routes on the ai-router.ts path (callAiModel) throw AiCallError instead
  // of AiResponseError — same shape, handled the same way here so every
  // route can share one catch-all.
  if (error instanceof AiCallError) {
    return Response.json({ error: error.message, code: "AI_RESPONSE_ERROR" }, { status: error.status });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
