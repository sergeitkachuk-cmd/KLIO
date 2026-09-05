type Geography = { label: string; detail: string };

export type TavilyResearch = {
  query: string;
  results: Array<{ title: string; url: string; content: string }>;
};

export type TavilyExtract = { url: string; content: string };

type TavilyResponse = {
  results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
};

type TavilyExtractResponse = {
  results?: Array<{ url?: unknown; raw_content?: unknown }>;
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

async function tavilySearch(query: string, maxResults: number, cacheNamespace: string): Promise<TavilyResearch | null> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  const normalizedQuery = clean(query, 700);
  if (!apiKey || !normalizedQuery) return null;

  const key = `${cacheNamespace}:${normalizedQuery.toLocaleLowerCase("ru-RU")}`;
  const cached = researchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) researchCache.delete(key);

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: normalizedQuery, topic: "general", search_depth: "fast", max_results: maxResults, include_answer: false, include_raw_content: false, include_images: false }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.warn("Tavily search unavailable", response.status);
      return null;
    }
    const payload = await response.json() as TavilyResponse;
    const results = Array.isArray(payload.results) ? payload.results.map((item) => ({ title: clean(item.title, 160), url: clean(item.url, 300), content: clean(item.content, 420) }))
      .filter((item) => item.title && item.url && item.content).slice(0, maxResults) : [];
    if (!results.length) return null;

    const value = { query: normalizedQuery, results };
    if (researchCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = researchCache.keys().next().value;
      if (oldestKey) researchCache.delete(oldestKey);
    }
    researchCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.warn("Tavily search failed", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}

// This is deliberately a single, server-controlled request.  DeepSeek never
// receives a search tool, so it cannot decide to make more searches or enter
// an agent loop.  A short cached digest is enough to ground a content plan.
export async function researchContentPlanWeb(topic: string, geography: Geography[], currentIndustryFocus = false): Promise<TavilyResearch | null> {
  const geographyHint = geography.slice(0, 2).map((item) => [item.label, item.detail].filter(Boolean).join(", ")).filter(Boolean).join("; ");
  const query = `${topic}${geographyHint ? ` ${geographyHint}` : ""} ${currentIndustryFocus ? "актуальные отраслевые тренды, изменения, новости и запросы аудитории" : "актуальная информация, вопросы аудитории и критерии выбора"}`;
  return tavilySearch(query, 5, `content-plan:${cacheKey(topic, geography)}`);
}

// For "КЛИО Глубина" (deepen) specifically: researchContentPlanWeb's query
// ("актуальная информация, вопросы аудитории и критерии выбора") is tuned
// for discovering new content-plan topics, not for finding the concrete
// numbers, criteria or standards an already-written draft is missing. A
// generic marketing-style query kept surfacing generic marketing-style
// pages, so the model had nothing specific to add and fell back to noting
// a gap in editorial_comment instead of actually filling it (site owner:
// asked for lab-marker specifics, got "not in the sources provided" even
// though a real search should have found them). This query is deliberately
// biased toward pages that carry citable specifics.
export async function researchAdaptationFacts(topic: string): Promise<TavilyResearch | null> {
  const query = `${topic} конкретные цифры, показатели, критерии, нормы и подтверждённые факты`;
  return tavilySearch(query, 6, `adaptation-deepen:${cacheKey(topic, [])}`);
}

export async function discoverTavilyWeb(query: string): Promise<TavilyResearch | null> {
  return tavilySearch(query, 12, "competitors");
}

export async function extractTavilyWebsite(url: string): Promise<TavilyExtract | null> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  const requestedUrl = clean(url, 700);
  if (!apiKey || !requestedUrl) return null;
  try {
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [requestedUrl], extract_depth: "basic", format: "text", include_images: false, timeout: 8 }),
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) {
      console.warn("Tavily extract unavailable", response.status);
      return null;
    }
    const payload = await response.json() as TavilyExtractResponse;
    const first = Array.isArray(payload.results) ? payload.results[0] : null;
    const content = clean(first?.raw_content, 14_000);
    const resolvedUrl = clean(first?.url, 700) || requestedUrl;
    return content ? { url: resolvedUrl, content } : null;
  } catch (error) {
    console.warn("Tavily extract failed", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}
