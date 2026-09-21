import { aiConfigured } from "../_lib/ai-config";

// Deliberately does not report which model is behind the connection — the
// AI router (ai-config.ts/ai-router.ts) picks Luna/Nano (or their DeepSeek
// equivalents) per operation automatically, and end users must never see
// or choose a model.
export async function GET() {
  const connected = aiConfigured();
  // Deployment marker: a healthy old container must not be mistaken for
  // the release with bounded, reasoning-enabled material generation.
  return Response.json({ connected, configured: connected, health: "unknown" }, { headers: {
    "Cache-Control": "no-store",
    "X-Klio-Carousel-Publish": "2026-09-21-rich-slides-direct-upload-v1",
    "X-Klio-Dialogue-Release": "2026-09-20-render-text-relay-v4",
    "X-Klio-Payment-Diagnostics": "2026-09-19-checkout-stage-v1",
    "X-Klio-Publication-Safety": "2026-09-14-network-errors-v1",
    "X-Klio-Audit-Release": "2026-09-12-ai-publish-safety-v3",
    "X-Klio-Auth-Release": "2026-09-12-request-time-session-v2",
    "X-Klio-Workspace-Release": "2026-09-12-versioned-saves-v1",
    "X-Klio-Material-Release": "2026-09-12-editor-conflict-v1",
    "X-Klio-Session-Release": "2026-09-12-reset-atomic-v1",
    "X-Klio-Archive-Release": "2026-09-12-brand-pagination-v1",
    "X-Klio-Request-Release": "2026-09-12-bounded-auth-v1",
    "X-Klio-Brand-Release": "2026-09-12-atomic-brand-limit-v1",
    "X-Klio-Generation-Guard": "2026-09-13-shared-mode-gate-v1",
    "X-Klio-Generation-Commit": "2026-09-13-atomic-result-v1",
    "X-Klio-Job-Lifecycle": "2026-09-13-guarded-transitions-v1",
    "X-Klio-Secondary-Commit": "2026-09-13-atomic-secondary-v1",
    "X-Klio-Verification": "2026-09-13-single-use-v1",
    "X-Klio-Rate-Limit": "2026-09-13-preserve-active-v1",
    "X-Klio-Account-Throttle": "2026-09-13-account-buckets-v1",
    "X-Klio-Vk-Guard": "2026-09-13-bounded-login-v1",
    "X-Klio-OAuth-Deadline": "2026-09-13-shared-deadline-v1",
    "X-Klio-Invoice-Guard": "2026-09-13-owner-check-v1",
    "X-Klio-Payment-Input": "2026-09-13-bounded-json-v1",
    "X-Klio-Upd-Guard": "2026-09-13-single-claim-v1",
    "X-Klio-Bank-Deadline": "2026-09-13-bounded-provider-v1",
    "X-Klio-Checkout-Input": "2026-09-13-bounded-shared-prices-v1",
    "X-Klio-Ai-Release": "2026-09-10-v4-1-output-budget-v2",
    "X-Klio-Ui-Release": "2026-09-10-larger-material-topic-titles",
    "X-Klio-Admin-Release": "2026-09-07-ai-latency-visible",
    "X-Klio-Editor-Release": "2026-09-07-search-fallback-v3",
    "X-Klio-Generator-Release": "2026-09-07-bounded-latency-v2",
  } });
}
