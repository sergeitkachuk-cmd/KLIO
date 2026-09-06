import { AiCallError } from "./ai-router";
import { OPERATION_CONFIG, type AiOperation } from "./ai-config";

export function materialOutputTokenBudget(targetCharacters: number, operation: AiOperation) {
  const config = OPERATION_CONFIG[operation];
  const textBudget = Math.max(1_100, Math.min(10_000, Math.ceil(targetCharacters / 2.2) + 900));
  // The provider has a combined ceiling, not separate enforceable quotas.
  // Add headroom for thinking instead of taking it from the text allowance.
  const thinkingHeadroom = config.reasoningEffort === "none" ? 0 : targetCharacters <= 2000 ? 2048 : 4096;
  return Math.min(config.maxOutputTokens, textBudget + thinkingHeadroom);
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
