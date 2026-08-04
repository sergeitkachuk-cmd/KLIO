export async function GET() {
  const connected = Boolean(process.env.OPENAI_API_KEY?.trim());
  const model = connected ? (process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra") : null;

  return Response.json({ connected, model }, { headers: { "Cache-Control": "no-store" } });
}
