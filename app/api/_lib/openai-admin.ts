export type OpenAiAdminSummary = {
  configured: boolean;
  status: "connected" | "needs_setup" | "unavailable";
  totalCostUsd: number | null;
  imageBuckets: number | null;
  periodLabel: string;
  error: string | null;
};

function numeric(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function resultsOf(body: unknown): Array<Record<string, unknown>> {
  const root = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const data = Array.isArray(root.data) ? root.data : [];
  return data.flatMap((bucket) => {
    if (!bucket || typeof bucket !== "object") return [];
    const record = bucket as Record<string, unknown>;
    return Array.isArray(record.results)
      ? record.results.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [record];
  });
}

function costFrom(body: unknown): number {
  return resultsOf(body).reduce((sum, result) => {
    const amount = result.amount && typeof result.amount === "object" ? result.amount as Record<string, unknown> : {};
    return sum + numeric(amount.value);
  }, 0);
}

function imageBucketCount(body: unknown): number {
  const root = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return Array.isArray(root.data) ? root.data.length : 0;
}

async function readJson(url: string, key: string): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, body };
}

/**
 * Organization-level usage is intentionally opt-in. OPENAI_API_KEY is a
 * project/runtime key and is not silently reused as an Admin API key.
 */
export async function getOpenAiAdminSummary(now = new Date()): Promise<OpenAiAdminSummary> {
  const key = process.env.OPENAI_ADMIN_KEY?.trim() || process.env.OPENAI_ADMIN_API_KEY?.trim();
  const periodLabel = "последние 30 дней";
  if (!key) return { configured: false, status: "needs_setup", totalCostUsd: null, imageBuckets: null, periodLabel, error: null };

  const end = Math.floor(now.getTime() / 1000);
  const start = end - 30 * 24 * 60 * 60;
  const query = `start_time=${start}&end_time=${end}&bucket_width=1d`;
  try {
    const [costs, images] = await Promise.all([
      readJson(`https://api.openai.com/v1/organization/costs?${query}`, key),
      readJson(`https://api.openai.com/v1/organization/usage/images?${query}`, key),
    ]);
    if (!costs.ok && !images.ok) return { configured: true, status: "unavailable", totalCostUsd: null, imageBuckets: null, periodLabel, error: "OpenAI Admin API не вернул данные." };
    return {
      configured: true,
      status: "connected",
      totalCostUsd: costs.ok ? costFrom(costs.body) : null,
      imageBuckets: images.ok ? imageBucketCount(images.body) : null,
      periodLabel,
      error: costs.ok && images.ok ? null : "Часть организационной статистики OpenAI недоступна.",
    };
  } catch {
    return { configured: true, status: "unavailable", totalCostUsd: null, imageBuckets: null, periodLabel, error: "Не удалось получить организационную статистику OpenAI." };
  }
}
