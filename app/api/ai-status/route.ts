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
    "X-Klio-Audit-Release": "2026-09-12-ai-publish-safety-v3",
    "X-Klio-Auth-Release": "2026-09-12-request-time-session-v2",
    "X-Klio-Workspace-Release": "2026-09-12-versioned-saves-v1",
    "X-Klio-Material-Release": "2026-09-12-editor-conflict-v1",
    "X-Klio-Session-Release": "2026-09-12-reset-atomic-v1",
    "X-Klio-Archive-Release": "2026-09-12-brand-pagination-v1",
    "X-Klio-Ai-Release": "2026-09-10-v4-1-output-budget-v2",
    "X-Klio-Ui-Release": "2026-09-10-larger-material-topic-titles",
    "X-Klio-Admin-Release": "2026-09-07-ai-latency-visible",
    "X-Klio-Editor-Release": "2026-09-07-search-fallback-v3",
    "X-Klio-Generator-Release": "2026-09-07-bounded-latency-v2",
  } });
}
