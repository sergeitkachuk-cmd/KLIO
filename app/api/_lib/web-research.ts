type Geography = { label: string; detail: string };

export type WebResearch = {
  query: string;
  provider?: "deepseek" | "yandex";
  results: Array<{ title: string; url: string; content: string }>;
  freshNews?: boolean;
};

export type WebPage = { url: string; content: string };

type DeepSeekSearchResponse = {
  results?: Array<{ title?: unknown; url?: unknown; snippet?: unknown; summary?: unknown; content?: unknown; rerank_score?: unknown }>;
};

type DeepSeekFetchResponse = { title?: unknown; content?: unknown };

// DeepSeek Search & Fetch API (released 2026-10-17): the same key and account
// balance as the text models, $0.75 per 1,000 successful requests; failed,
// empty and timed-out requests are not billed. https://api-docs.deepseek.com/guides/search/
const DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search";
const DEEPSEEK_FETCH_URL = "https://api.deepseek.com/v1/tools/fetch";
// Hard API limit for both `query` and `ori_question`, operators included.
const QUERY_LIMIT = 128;
// rerank_score is 0–3; DeepSeek documents 1.5+ as high quality.
const RELEVANT_SCORE = 1;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const researchCache = new Map<string, { expiresAt: number; value: WebResearch }>();
let searchUnavailableUntil = 0;

// User-generated / uncurated platforms that repeatedly surfaced as "sources"
// for material facts despite having no editorial vetting — student coursework
// dumps, free-blog posts, social-network pages (site owner: flagged this
// twice, once for unrelated-homonym noise and once for studfile.net/wordpress
// blog/textarchive.ru showing up as "facts" for an editorial-methodology
// piece). Filtered from the results rather than sent as -site: operators,
// which would use up most of DeepSeek's 128-character query limit.
const LOW_AUTHORITY_DOMAINS = ["studfile.net", "textarchive.ru", "dzen.ru", "vk.com", "wordpress.com"];

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

// Instructions addressed to KLIO ("найди в интернете", "добавь это в пост")
// are noise to a search engine: only the subject should reach the query.
const QUERY_FILLER = /(?<!\p{L})(?:пожалуйста|найди(?:те)?|поищи(?:те)?|проверь(?:те)?|посмотри(?:те)?|изучи(?:те)?|сверь(?:те)?|добавь(?:те)?|вставь(?:те)?|напиши(?:те)?|сделай(?:те)?|помоги(?:те)?|расскажи(?:те)?|подскажи(?:те)?|в интернете|в сети|в вебе|это|в пост|в статью|в текст|мне|нам)(?!\p{L})/giu;

// Removing the filler can leave "…эффект и" or ", а" hanging at the end.
function trimQueryTail(value: string) {
  let previous;
  do {
    previous = value;
    value = value.replace(/[\s,;:—–-]+$/, "").replace(/\s+(?:и|а|или|но)$/iu, "");
  } while (value !== previous);
  return value;
}

export function searchQuery(text: string, maxLength = QUERY_LIMIT) {
  const condensed = trimQueryTail(clean(text, 2_000).replace(QUERY_FILLER, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ")
    .replace(/^[\s,.;:!?—–-]+/, "").trim());
  if (condensed.length <= maxLength) return condensed;
  const cut = condensed.slice(0, maxLength + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return trimQueryTail(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut.slice(0, maxLength));
}

function cacheKey(topic: string, geography: Geography[]) {
  return [topic, ...geography.slice(0, 3).map((item) => `${item.label} ${item.detail}`)]
    .join(" ")
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ")
    .trim();
}

function remember(key: string, value: WebResearch) {
  if (researchCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = researchCache.keys().next().value;
    if (oldestKey) researchCache.delete(oldestKey);
  }
  researchCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function cached(key: string) {
  const entry = researchCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  if (entry) researchCache.delete(key);
  return null;
}

function lowAuthority(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOW_AUTHORITY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return true;
  }
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function deepseekSearch(subject: string, maxResults: number, cacheNamespace: string, options?: {
  // The user's real question, used by DeepSeek to rerank results.
  question?: string;
  // Full page text in addition to DeepSeek's model-oriented summary.
  deep?: boolean;
  contentLength?: number;
  timeoutMs?: number;
  // Only pages published within this many days (the `after:` operator).
  recentDays?: number;
}): Promise<WebResearch | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const after = options?.recentDays ? ` after:${daysAgo(options.recentDays)}` : "";
  const base = searchQuery(subject, QUERY_LIMIT - after.length);
  if (!apiKey || !base) return null;
  if (Date.now() < searchUnavailableUntil) return null;
  const query = `${base}${after}`;
  const question = options?.question ? searchQuery(options.question) : "";

  // The date operator changes daily, so the cache key uses the subject only.
  const key = `${cacheNamespace}:${base.toLocaleLowerCase("ru-RU")}${after ? ":recent" : ""}`;
  const hit = cached(key);
  if (hit) return hit;

  try {
    const response = await fetch(DEEPSEEK_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, count: Math.min(50, maxResults * 2), ...(question ? { ori_question: question } : {}), need_content: options?.deep === true }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 10_000),
    });
    if (!response.ok) {
      console.warn("DeepSeek search unavailable", response.status);
      // 401/402 (key or balance) and 429/5xx are account- or service-wide;
      // a 400 only means this one query was rejected.
      if (response.status === 401 || response.status === 402) searchUnavailableUntil = Date.now() + 10 * 60 * 1000;
      else if (response.status === 429 || response.status >= 500) searchUnavailableUntil = Date.now() + 60 * 1000;
      return null;
    }
    const payload = await response.json() as DeepSeekSearchResponse;
    const contentLength = options?.contentLength ?? 420;
    const seen = new Set<string>();
    const results = (Array.isArray(payload.results) ? payload.results : []).flatMap((item) => {
      const url = clean(item.url, 300);
      const title = clean(item.title, 160);
      const summary = clean(item.summary, 2_000) || clean(item.snippet, 600);
      const page = options?.deep ? clean(item.content, 6_000) : "";
      const content = clean([summary, page].filter(Boolean).join(" "), contentLength);
      if (!url || !title || !content || seen.has(url) || lowAuthority(url)) return [];
      seen.add(url);
      return [{ title, url, content, score: typeof item.rerank_score === "number" ? item.rerank_score : RELEVANT_SCORE }];
    });
    // Prefer clearly relevant pages, but don't throw away a thin result set.
    const relevant = results.filter((item) => item.score >= RELEVANT_SCORE);
    const chosen = (relevant.length >= Math.min(3, results.length) ? relevant : results)
      .slice(0, maxResults)
      .map(({ title, url, content }) => ({ title, url, content }));
    if (!chosen.length) return null;

    const value: WebResearch = { query, provider: "deepseek", results: chosen };
    remember(key, value);
    return value;
  } catch (error) {
    console.warn("DeepSeek search failed", error instanceof Error ? error.name : "unknown error");
    searchUnavailableUntil = Date.now() + 60 * 1000;
    return null;
  }
}

function decodeSearchXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function publicSearchUrl(value: string) {
  try {
    const url = new URL(decodeSearchXml(value).trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

// Timeweb already uses Yandex Search for Wordstat/competitor discovery. It is
// a server-side search service too, so it is a safe fallback when DeepSeek
// search is out of balance or temporarily unavailable.
async function yandexResearch(query: string, maxResults: number): Promise<WebResearch | null> {
  const apiKey = process.env.YANDEX_SEARCH_API_KEY?.trim();
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  // Yandex's API has no exclude_domains field, but its query syntax does.
  const normalizedQuery = clean(`${query} ${LOW_AUTHORITY_DOMAINS.map((domain) => `-site:${domain}`).join(" ")}`, 400);
  if (!apiKey || !folderId || !normalizedQuery) return null;
  const cacheId = `yandex-research:${normalizedQuery.toLocaleLowerCase("ru-RU")}`;
  const hit = cached(cacheId);
  if (hit) return hit;
  try {
    const response = await fetch("https://searchapi.api.cloud.yandex.net/v2/web/search", {
      method: "POST",
      headers: { Authorization: `Api-Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId,
        responseFormat: "FORMAT_XML",
        query: { searchType: "SEARCH_TYPE_RU", queryText: normalizedQuery, familyMode: "FAMILY_MODE_STRICT" },
        groupingSpec: { groupMode: "GROUP_MODE_FLAT", groupsOnPage: Math.max(5, maxResults), docsInGroup: 1 },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.warn("Yandex research fallback unavailable", response.status);
      return null;
    }
    const payload = await response.json() as { rawData?: unknown };
    if (typeof payload.rawData !== "string") return null;
    const xml = Buffer.from(payload.rawData, "base64").toString("utf8");
    const results = [...xml.matchAll(/<doc[\s\S]*?<\/doc>/gi)].map((match) => {
      const block = match[0];
      const url = publicSearchUrl(block.match(/<url>([\s\S]*?)<\/url>/i)?.[1] || "");
      const title = clean(decodeSearchXml(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]*>/g, " "), 160);
      const passages = [...block.matchAll(/<passage>([\s\S]*?)<\/passage>/gi)]
        .map((item) => decodeSearchXml(item[1]).replace(/<[^>]*>/g, " "));
      const content = clean(passages.join(" "), 1_200);
      return { title: title || url, url, content };
    }).filter((item) => item.title && item.url && item.content).slice(0, maxResults);
    if (!results.length) return null;
    const value: WebResearch = { query: normalizedQuery, provider: "yandex", results };
    remember(cacheId, value);
    return value;
  } catch (error) {
    console.warn("Yandex research fallback failed", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}

async function searchWithFallback(...args: Parameters<typeof deepseekSearch>) {
  const [subject, maxResults] = args;
  return await deepseekSearch(...args) ?? yandexResearch(searchQuery(subject, 300), maxResults);
}

// Every search is a single server-controlled request: the model never
// receives a search tool, so it cannot decide to make more searches or enter
// an agent loop.
//
// News mode (currentIndustryFocus) needs an industry-level subject: a small
// or regional brand's own name has no news, and a plain search has no time
// bias, so the toggle used to silently produce the same generic plan (site
// owner report). industryField — the brand's plain products/services list —
// is preferred, and the search is limited to the last month. When the
// industry genuinely has nothing that recent, an unscoped search still gives
// the model real industry context, labelled freshNews:false so the plan does
// not claim it found current news.
export async function researchContentPlanWeb(topic: string, geography: Geography[], currentIndustryFocus = false, industryField = ""): Promise<WebResearch | null> {
  const geographyHint = geography.slice(0, 2).map((item) => [item.label, item.detail].filter(Boolean).join(", ")).filter(Boolean).join("; ");
  if (!currentIndustryFocus) {
    return await searchWithFallback(`${topic}${geographyHint ? ` ${geographyHint}` : ""}`, 5, `content-plan:${cacheKey(topic, geography)}`, {
      question: `Что важно аудитории и как выбирают: ${topic}`,
    });
  }
  const newsSubject = industryField || topic;
  const recent = await deepseekSearch(`${newsSubject} новости отрасли`, 5, `content-plan-news:${cacheKey(newsSubject, [])}`, { recentDays: 30 });
  if (recent) return { ...recent, freshNews: true };
  const fallback = await searchWithFallback(`${newsSubject} тренды и практики отрасли`, 5, `content-plan:${cacheKey(newsSubject, [])}`);
  if (fallback) return { ...fallback, freshNews: false };
  // deepseekSearch only warns on a hard API error, not on an empty result,
  // so log the subject to tell the two apart. A brand profile
  // without "Продукты/услуги" (newsSubject falls back to the brand name) is
  // the most likely cause of a genuinely empty result.
  console.warn("researchContentPlanWeb found nothing in either mode", JSON.stringify({ newsSubject, industryFieldProvided: Boolean(industryField) }));
  return null;
}

// Writing needs substantive facts, not topic-discovery snippets. "advanced"
// adds full page text to DeepSeek's summary for SEO, landing pages and
// evidence-heavy topics.
export async function researchMaterialWeb(topic: string, geography: Geography[], depth: "basic" | "advanced" = "basic"): Promise<WebResearch | null> {
  const geographyHint = geography.slice(0, 2).map((item) => clean(item.label, 60)).join(", ");
  const deep = depth === "advanced";
  return await searchWithFallback(`${clean(topic, 450)} ${geographyHint}`, 5, `material-facts-${depth}-v2`, {
    question: `Подтверждённые факты, первоисточники и практические нюансы: ${topic}`,
    deep,
    contentLength: deep ? 1800 : 800,
    timeoutMs: deep ? 12_000 : 10_000,
  });
}

// Used by the text editors (КЛИО Глубина etc.) and the dialogue. Tuned for
// concrete numbers, criteria or standards rather than generic topic
// discovery. `recent` is for "новости"/"что изменилось" questions: it limits
// results to the last month. A plain fact lookup must not be time-scoped —
// the current standard can genuinely be a 2012 document.
export async function researchAdaptationFacts(topic: string, recent = false): Promise<WebResearch | null> {
  return await searchWithFallback(topic, 6, `adaptation-facts-${recent ? "recent-v2" : "v3"}:${cacheKey(topic, [])}`, {
    question: recent ? `Что нового и что изменилось: ${topic}` : `Конкретные цифры, нормы и подтверждённые факты: ${topic}`,
    deep: true,
    contentLength: 1_800,
    timeoutMs: 12_000,
    ...(recent ? { recentDays: 30 } : {}),
  });
}

export async function discoverWeb(query: string): Promise<WebResearch | null> {
  return deepseekSearch(query, 12, "competitors");
}

export async function fetchWebPage(url: string): Promise<WebPage | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const requestedUrl = clean(url, 700);
  if (!apiKey || !requestedUrl) return null;
  try {
    const response = await fetch(DEEPSEEK_FETCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: requestedUrl }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.warn("DeepSeek fetch unavailable", response.status);
      return null;
    }
    const payload = await response.json() as DeepSeekFetchResponse;
    const content = clean(payload.content, 14_000);
    return content ? { url: requestedUrl, content } : null;
  } catch (error) {
    console.warn("DeepSeek fetch failed", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}
