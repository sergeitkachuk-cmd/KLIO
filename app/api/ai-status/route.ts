// Deliberately does not report which model is behind the connection — the
// AI router (ai-config.ts/ai-router.ts) picks Luna/Nano per operation
// automatically, and end users must never see or choose a model.
export async function GET() {
  const connected = Boolean(process.env.OPENAI_API_KEY?.trim());
  return Response.json({ connected }, { headers: { "Cache-Control": "no-store" } });
}
