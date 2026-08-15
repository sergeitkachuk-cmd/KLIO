type Geography = { label: string; detail: string };

export type TavilyResearch = {
  query: string;
  results: Array<{ title: string; url: string; content: string }>;
};

type TavilyResponse = {
  results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const researchCache = new Map<string, { expiresAt: number; value: TavilyResearch }>();

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cacheKey(topic: string, geography: Geography[]) {
  return [topic, ...geography.slice(0, 3).map((item) => `${item.label} ${item.detail}`)]
    .join(" ")
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ")
    .trim();
}

// This is deliberately a single, server-controlled request.  DeepSeek never
// receives a search tool, so it cannot decide to make more searches or enter
// an agent loop.  A short cached digest is enough to ground a content plan.
export async function researchContentPlanWeb(topic: string, geography: Geography[]): Promise<TavilyResearch | null> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return null;

  const key = cacheKey(topic, geography);
  if (!key) return null;
  const cached = researchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) researchCache.delete(key);

  const geographyHint = geography.slice(0, 2).map((item) => [item.label, item.detail].filter(Boolean).join(", ")).filter(Boolean).join("; ");
  const query = `${topic}${geographyHint ? ` ${geographyHint}` : ""} актуальная информация, вопросы аудитории и критерии выбора`;

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query.slice(0, 700),
        topic: "general",
        search_depth: "fast",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.warn("Tavily content-plan search unavailable", response.status);
      return null;
    }

    const payload = await response.json() as TavilyResponse;
    const results = Array.isArray(payload.results) ? payload.results.map((item) => ({
      title: clean(item.title, 160),
      url: clean(item.url, 300),
      content: clean(item.content, 420),
    })).filter((item) => item.title && item.url && item.content).slice(0, 5) : [];
    if (!results.length) return null;

    const value = { query: clean(query, 700), results };
    if (researchCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = researchCache.keys().next().value;
      if (oldestKey) researchCache.delete(oldestKey);
    }
    researchCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.warn("Tavily content-plan search failed", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}
