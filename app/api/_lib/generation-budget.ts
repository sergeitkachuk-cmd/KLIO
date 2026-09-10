import { AiCallError } from "./ai-router";
import { OPERATION_CONFIG, type AiOperation, type ReasoningEffort } from "./ai-config";

export function materialOutputTokenBudget(targetCharacters: number, operation: AiOperation) {
  const config = OPERATION_CONFIG[operation];
  const textBudget = Math.max(1_100, Math.min(10_000, Math.ceil(targetCharacters / 2.2) + 900));
  // The provider has a combined ceiling, not separate enforceable quotas.
  // DeepSeek can spend more than 2k tokens on low-effort reasoning even for
  // a short post. The old target-sized ceiling made 1,600 characters map to
  // exactly 3,676 output tokens; a real provider response consumed all 3,676
  // and ended as incomplete before emitting the final JSON. Keep reasoning,
  // but give every reasoning-enabled material a safe 10k combined floor.
  const thinkingHeadroom = config.reasoningEffort === "none" ? 0 : targetCharacters <= 2000 ? 8192 : 4096;
  const combinedBudget = textBudget + thinkingHeadroom;
  return Math.min(config.maxOutputTokens, config.reasoningEffort === "none" ? combinedBudget : Math.max(10_000, combinedBudget));
}

export function adaptationOutputTokenBudget(sourceCharacters: number, reasoningEffort: ReasoningEffort) {
  // An editor normally returns roughly the source length plus six compact
  // metadata fields. DeepSeek's max_output_tokens also includes its hidden
  // reasoning, so reserve that separately for judgement-heavy modes.
  const visibleTextBudget = Math.max(2_200, Math.min(10_000, Math.ceil(sourceCharacters / 2.2) + 1_200));
  const thinkingHeadroom = reasoningEffort === "none" ? 0 : 4_096;
  return Math.min(OPERATION_CONFIG.adapt_text.maxOutputTokens, visibleTextBudget + thinkingHeadroom);
}

export function createGenerationBudget(totalMs = 150_000) {
  const deadline = Date.now() + totalMs;
  return {
    remainingMs: () => Math.max(0, deadline - Date.now()),
    timeoutMs(capMs: number) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new AiCallError("Истекло время подготовки материала. Повторите запрос чуть позже.", 504);
      return Math.max(1, Math.min(capMs, remaining));
    },
  };
}
