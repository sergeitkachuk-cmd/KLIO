import { aiConfigured } from "../_lib/ai-config";

// Deliberately does not report which model is behind the connection — the
// AI router (ai-config.ts/ai-router.ts) picks Luna/Nano (or their DeepSeek
// equivalents) per operation automatically, and end users must never see
// or choose a model.
export async function GET() {
  const connected = aiConfigured();
  return Response.json({ connected }, { headers: { "Cache-Control": "no-store" } });
}
