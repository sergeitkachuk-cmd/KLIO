import { aiConfigured } from "../_lib/ai-config";

// Deliberately does not report which model is behind the connection — the
// AI router (ai-config.ts/ai-router.ts) picks Luna/Nano (or their DeepSeek
// equivalents) per operation automatically, and end users must never see
// or choose a model.
export async function GET() {
  const connected = aiConfigured();
  // Deployment marker: a healthy old container must not be mistaken for
  // the release with bounded, reasoning-enabled material generation.
  return Response.json({ connected }, { headers: {
    "Cache-Control": "no-store",
    "X-Klio-Ai-Release": "2026-09-06-reasoning-research-v1",
    "X-Klio-Ui-Release": "2026-09-07-volume-control-removed",
  } });
}
