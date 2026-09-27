import { fetchPublicResource, PublicFetchError } from "./public-fetch";

export type WebsiteContext = {
  requestedUrl: string;
  resolvedUrl: string;
  status: "not_provided" | "loaded" | "unavailable" | "blocked";
  text: string;
};

const EMPTY_CONTEXT: WebsiteContext = {
  requestedUrl: "",
  resolvedUrl: "",
  status: "not_provided",
  text: "",
};

const WEBSITE_CACHE_MAX_ENTRIES = 100;
const WEBSITE_CACHE_TTL_MS = 60 * 60 * 1000;
const WEBSITE_FAILURE_CACHE_TTL_MS = 2 * 60 * 1000;
const WEBSITE_MAX_PAGES = 400;
const WEBSITE_MAX_SITEMAPS = 32;
const WEBSITE_STANDARD_MAX_PAGES = 4;
const WEBSITE_STANDARD_BUDGET_MS = 10_000;
const WEBSITE_CRAWL_CONCURRENCY = 16;
const WEBSITE_CRAWL_BUDGET_MS = 60_000;
const WEBSITE_PAGE_TIMEOUT_MS = 2_000;
const WEBSITE_PAGE_MAX_BYTES = 400_000;
const WEBSITE_SITEMAP_MAX_BYTES = 1_500_000;
const WEBSITE_TEXT_MAX_BYTES = 200_000;
const WEBSITE_CONTEXT_TEXT_LIMIT = 42_000;
const websiteContextCache = new Map<string, { expiresAt: number; value: WebsiteContext }>();
const websiteContextInFlight = new Map<string, Promise<WebsiteContext>>();

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 10
    || first === 127
    || first === 0
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
}

function normalizePublicUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(candidate);
    const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
    const blockedHost = hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || hostname.includes(":")
      || isPrivateIpv4(hostname);

    if (!/^https?:$/.test(url.protocol) || url.username || url.password || blockedHost || !hostname.includes(".")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function decodeHtml(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    quot: "\"",
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    laquo: "«",
    raquo: "»",
  };

  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLocaleLowerCase("en-US")] ?? match);
}

function tagText(html: string, pattern: RegExp) {
  return [...html.matchAll(pattern)]
    .map((match) => decodeHtml((match[1] || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractWebsiteText(html: string) {
  const safeHtml = html
    .slice(0, 600_000)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const title = tagText(safeHtml, /<title\b[^>]*>([\s\S]*?)<\/title>/gi).slice(0, 1);
  const description = [...safeHtml.matchAll(/<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => decodeHtml(match[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2);
  const headings = tagText(safeHtml, /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi).slice(0, 28);
  const content = tagText(safeHtml, /<(?:p|li|dt|dd)\b[^>]*>([\s\S]*?)<\/(?:p|li|dt|dd)>/gi)
    .filter((item) => item.length >= 24)
    .slice(0, 90);
  return [...new Set([...title, ...description, ...headings, ...content])].join("\n").slice(0, 14_000);
}

function normalizeSameOriginUrl(value: string, baseUrl: string) {
  try {
    const base = new URL(baseUrl);
    const candidate = normalizePublicUrl(new URL(value, base).toString());
    if (!candidate || candidate.origin !== base.origin) return null;
    candidate.hash = "";
    candidate.search = "";
    return candidate;
  } catch {
    return null;
  }
}

function normalizeCrawlPageUrl(value: string, baseUrl: string) {
  const candidate = normalizeSameOriginUrl(value, baseUrl);
  if (!candidate) return null;
  // Query strings commonly create endless tracking, filtering and calendar
  // variants. Sitemap entries and normal content pages use clean paths.
  try {
    if (/\/(?:login|signin|sign-in|register|cart|checkout|wp-admin|api|search)(?:\/|$)/i.test(candidate.pathname)) return null;
    if (/\.(?:pdf|zip|rar|docx?|xlsx?|csv|png|jpe?g|gif|webp|svg|mp4|mp3|xml|json|css|js|woff2?)$/i.test(candidate.pathname)) return null;
    return candidate;
  } catch {
    return null;
  }
}

// Follow every useful same-origin link found on fetched pages. The crawl is
// also seeded from sitemap.xml and Sitemap entries in robots.txt, and is
// bounded by page, byte, concurrency and wall-clock limits below.
function extractInternalPageLinks(html: string, baseUrl: string) {
  const base = normalizePublicUrl(baseUrl);
  if (!base) return [] as URL[];
  const seen = new Set<string>();
  const links: URL[] = [];
  for (const match of html.slice(0, 600_000).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    if (links.length >= 180) break;
    const href = decodeHtml(match[1]).trim();
    if (!href || href.startsWith("#") || /^(?:mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    const candidate = normalizeCrawlPageUrl(href, base.toString());
    if (!candidate) continue;
    const key = candidate.toString();
    if (key === base.toString() || seen.has(key)) continue;
    seen.add(key);
    links.push(candidate);
  }
  for (const match of html.slice(0, 600_000).matchAll(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/gi)) {
    const candidate = normalizeCrawlPageUrl(decodeHtml(match[1]).trim(), base.toString());
    if (!candidate) continue;
    const key = candidate.toString();
    if (key !== base.toString() && !seen.has(key)) {
      seen.add(key);
      links.push(candidate);
    }
  }
  for (const match of html.slice(0, 600_000).matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^;]+;\s*url\s*=\s*["']?([^"'>]+)["']?[^>]*>/gi)) {
    const candidate = normalizeCrawlPageUrl(decodeHtml(match[1]).trim(), base.toString());
    if (!candidate) continue;
    const key = candidate.toString();
    if (key !== base.toString() && !seen.has(key)) {
      seen.add(key);
      links.push(candidate);
    }
  }
  const priority = (url: URL) => /(?:about|company|service|product|program|catalog|price|faq|blog|news|contact|direction|offer|услуг|продукт|программ|цен|контакт|о-компан|новост)/i.test(url.pathname) ? 0 : 1;
  return links.sort((a, b) => priority(a) - priority(b));
}

async function fetchPublicHtml(url: URL, timeoutMs = WEBSITE_PAGE_TIMEOUT_MS) {
  return fetchPublicResource(url, { maxBytes: WEBSITE_PAGE_MAX_BYTES, timeoutMs, truncate: true, accept: "text/html,application/xhtml+xml" });
}

async function fetchSitemapText(url: URL, timeoutMs: number) {
  try {
    const response = await fetchPublicResource(url, { maxBytes: WEBSITE_SITEMAP_MAX_BYTES, timeoutMs, truncate: true, accept: "application/xml,text/xml,text/plain,*/*" });
    return response?.ok && new URL(response.url).origin === url.origin ? await response.text() : "";
  } catch {
    return "";
  }
}

async function fetchPlainTextDocument(url: URL, timeoutMs: number) {
  try {
    const response = await fetchPublicResource(url, { maxBytes: WEBSITE_TEXT_MAX_BYTES, timeoutMs, truncate: true, accept: "text/plain,text/markdown,text/*;q=0.9,*/*;q=0.1" });
    const contentType = response?.headers.get("content-type") || "";
    if (!response?.ok || new URL(response.url).origin !== url.origin || !/(?:text\/|application\/(?:markdown|x-markdown))/i.test(contentType)) return "";
    return (await response.text()).trim().slice(0, 14_000);
  } catch {
    return "";
  }
}

function sitemapLocations(xml: string) {
  const locations = [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => decodeHtml(match[1].trim()))
    .filter(Boolean);
  return { index: /<sitemapindex\b/i.test(xml), locations };
}

async function discoverSitemapPages(rootUrl: string, deadline: number, sitemapLimit: number) {
  const root = new URL(rootUrl);
  const defaultSitemaps = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]
    .map((path) => new URL(path, root));
  const robotsUrl = new URL("/robots.txt", root);
  const initialTimeout = Math.max(1, Math.min(2_000, deadline - Date.now()));
  const [robots, ...defaultMaps] = await Promise.all([
    fetchSitemapText(robotsUrl, initialTimeout),
    ...defaultSitemaps.map((url) => fetchSitemapText(url, initialTimeout)),
  ]);
  const sitemapQueue: URL[] = [];
  const seenSitemaps = new Set<string>(defaultSitemaps.map((item) => item.toString()));
  const textDocuments = new Map<string, URL>();
  const addTextDocument = (value: string, baseUrl: string) => {
    const candidate = normalizeSameOriginUrl(value, baseUrl);
    if (candidate && /\.txt$/i.test(candidate.pathname)) textDocuments.set(candidate.toString(), candidate);
  };
  for (const match of robots.matchAll(/^\s*LLM-Policy\s*:\s*(\S+)/gim)) addTextDocument(match[1], root.toString());
  addTextDocument("/llms.txt", root.toString());
  for (const match of robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
    const sitemap = normalizeSameOriginUrl(match[1], root.toString());
    if (sitemap && seenSitemaps.size + sitemapQueue.length < sitemapLimit
      && !seenSitemaps.has(sitemap.toString())
      && !sitemapQueue.some((item) => item.toString() === sitemap.toString())) sitemapQueue.push(sitemap);
  }
  const pageUrls = new Map<string, URL>();
  const addLocations = (xml: string, sitemapUrl: URL) => {
    const parsed = sitemapLocations(xml);
    for (const location of parsed.locations) {
      const candidate = normalizeSameOriginUrl(location, sitemapUrl.toString());
      if (!candidate) continue;
      if (parsed.index || /\.xml(?:\.gz)?$/i.test(candidate.pathname)) {
        if (seenSitemaps.size + sitemapQueue.length < sitemapLimit
          && !seenSitemaps.has(candidate.toString())
          && !sitemapQueue.some((item) => item.toString() === candidate.toString())) sitemapQueue.push(candidate);
      } else {
        if (/\.txt$/i.test(candidate.pathname)) {
          addTextDocument(candidate.toString(), root.toString());
          continue;
        }
        const page = normalizeCrawlPageUrl(candidate.toString(), root.toString());
        if (page) pageUrls.set(page.toString(), page);
      }
    }
  };
  defaultMaps.forEach((xml, index) => addLocations(xml, defaultSitemaps[index]));
  while (sitemapQueue.length && seenSitemaps.size < sitemapLimit && Date.now() < deadline) {
    const batch: URL[] = [];
    while (sitemapQueue.length && batch.length < WEBSITE_CRAWL_CONCURRENCY && seenSitemaps.size < sitemapLimit) {
      const sitemap = sitemapQueue.shift()!;
      const key = sitemap.toString();
      if (seenSitemaps.has(key)) continue;
      seenSitemaps.add(key);
      batch.push(sitemap);
    }
    const remaining = deadline - Date.now();
    if (!batch.length || remaining <= 0) break;
    const sitemapResults = await Promise.all(batch.map(async (sitemap) => ({
      sitemap,
      xml: await fetchSitemapText(sitemap, Math.min(2_000, remaining)),
    })));
    for (const result of sitemapResults) if (result.xml) addLocations(result.xml, result.sitemap);
  }
  const remaining = deadline - Date.now();
  const documents = remaining > 0
    ? await Promise.all([...textDocuments.values()].map(async (documentUrl) => {
      const text = await fetchPlainTextDocument(documentUrl, Math.min(2_000, deadline - Date.now()));
      return text ? { url: documentUrl.toString(), text } : null;
    }))
    : [];
  return {
    pages: [...pageUrls.values()].slice(0, WEBSITE_MAX_PAGES - 1),
    documents: documents.filter((item): item is { url: string; text: string } => Boolean(item)),
  };
}

function compactWebsitePages(pages: Array<{ url: string; text: string }>) {
  if (!pages.length) return "";
  const inventoryBudget = Math.floor(WEBSITE_CONTEXT_TEXT_LIMIT * 0.52);
  const inventoryEntryBudget = Math.max(18, Math.floor(inventoryBudget / pages.length));
  const inventory = pages.map((page) => {
    const path = new URL(page.url).pathname || "/";
    const title = page.text.split("\n", 1)[0] || "";
    return `${path} — ${title}`.slice(0, inventoryEntryBudget);
  }).join("\n");
  const detailBudget = WEBSITE_CONTEXT_TEXT_LIMIT - Math.min(inventory.length, inventoryBudget);
  const detailPages = pages.filter((page) => page.text.trim()).sort((a, b) => {
    const score = (value: string) => {
      const path = new URL(value).pathname.toLowerCase();
      if (path === "/") return 0;
      if (/^\/(?:company|contacts|programs|pms|rooms|sales|faq|articles)\/?$/i.test(path)) return 1;
      if (/^\/(?:programs|pms|rooms|sales|faq|articles)\//i.test(path)) return 2;
      if (/^\/company\/(?:docs|dms)\//i.test(path)) return 4;
      return 3;
    };
    return score(a.url) - score(b.url) || b.text.length - a.text.length;
  }).slice(0, Math.min(40, pages.length));
  let remaining = detailBudget;
  const details = detailPages.map((page, index) => {
    const pagesLeft = detailPages.length - index;
    const bodyBudget = Math.max(0, Math.min(1_400, Math.floor(remaining / pagesLeft)));
    const path = new URL(page.url).pathname || "/";
    const body = page.text.slice(0, bodyBudget);
    remaining -= body.length;
    return `[${path}]\n${body}`;
  }).join("\n\n");
  return `Все страницы сайта (названия из сайта и sitemap):\n${inventory}\n\nОсновные страницы подробно:\n${details}`.slice(0, WEBSITE_CONTEXT_TEXT_LIMIT);
}

async function loadWebsiteContext(value: string, fullSite: boolean): Promise<WebsiteContext> {
  const requestedUrl = value.trim();
  if (!requestedUrl) return EMPTY_CONTEXT;
  const url = normalizePublicUrl(requestedUrl);
  if (!url) return { ...EMPTY_CONTEXT, requestedUrl, status: "blocked" };

  try {
    const pageLimit = fullSite ? WEBSITE_MAX_PAGES : WEBSITE_STANDARD_MAX_PAGES;
    const deadline = Date.now() + (fullSite ? WEBSITE_CRAWL_BUDGET_MS : WEBSITE_STANDARD_BUDGET_MS);
    const response = await fetchPublicHtml(url);
    if (!response) return { ...EMPTY_CONTEXT, requestedUrl, resolvedUrl: url.toString(), status: "blocked" };
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ...EMPTY_CONTEXT, requestedUrl, resolvedUrl: response.url || url.toString(), status: "unavailable" };
    }

    const html = await response.text();
    const resolvedUrl = response.url || url.toString();
    const startUrl = normalizeSameOriginUrl(resolvedUrl, resolvedUrl)?.toString() || resolvedUrl;
    const pages = new Map<string, { url: string; text: string }>();
    const initialText = extractWebsiteText(html);
    if (initialText || fullSite) pages.set(startUrl, { url: startUrl, text: initialText });
    const root = new URL(startUrl);
    const queue: URL[] = [];
    const queued = new Set<string>([startUrl]);
    const attempted = new Set<string>([startUrl]);
    const enqueue = (items: URL[]) => {
      for (const item of items) {
        const key = item.toString();
        if (queued.has(key) || attempted.size + queue.length >= pageLimit) continue;
        queued.add(key);
        queue.push(item);
      }
    };
    const discovered = fullSite ? await discoverSitemapPages(startUrl, deadline, WEBSITE_MAX_SITEMAPS) : { pages: [], documents: [] };
    for (const document of discovered.documents) pages.set(document.url, document);
    for (const pageUrl of discovered.pages) {
      const key = pageUrl.toString();
      if (!pages.has(key)) pages.set(key, { url: key, text: "" });
    }
    enqueue(discovered.pages);
    enqueue(extractInternalPageLinks(html, startUrl));
    while (queue.length && attempted.size < pageLimit && Date.now() < deadline) {
      const batch: URL[] = [];
      while (queue.length && batch.length < WEBSITE_CRAWL_CONCURRENCY && attempted.size < pageLimit) {
        const next = queue.shift()!;
        if (attempted.has(next.toString())) continue;
        attempted.add(next.toString());
        batch.push(next);
      }
      const batchResults = await Promise.all(batch.map(async (pageUrl) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        try {
          const page = await fetchPublicHtml(pageUrl, Math.min(WEBSITE_PAGE_TIMEOUT_MS, remaining));
          const pageType = page?.headers.get("content-type") || "";
          if (!page?.ok || !/text\/html|application\/xhtml\+xml/i.test(pageType)) return null;
          const pageHtml = await page.text();
          const finalUrl = normalizeSameOriginUrl(page.url || pageUrl.toString(), startUrl)?.toString();
          if (!finalUrl) return null;
          const text = extractWebsiteText(pageHtml);
          return { finalUrl, text, links: extractInternalPageLinks(pageHtml, finalUrl) };
        } catch {
          return null;
        }
      }));
      for (const result of batchResults) {
        if (!result) continue;
        const existing = pages.get(result.finalUrl);
        if (result.text && !existing?.text) pages.set(result.finalUrl, { url: result.finalUrl, text: result.text });
        enqueue(result.links);
      }
    }
    const text = compactWebsitePages([...pages.values()]);
    const hasReadableText = [...pages.values()].some((page) => page.text.trim());
    return {
      requestedUrl,
      resolvedUrl,
      status: text && hasReadableText ? "loaded" : "unavailable",
      text,
    };
  } catch (error) {
    return { ...EMPTY_CONTEXT, requestedUrl, resolvedUrl: url.toString(), status: error instanceof PublicFetchError && error.code === "blocked" ? "blocked" : "unavailable" };
  }
}

export async function readWebsiteContext(value: string, options: { fullSite?: boolean } = {}): Promise<WebsiteContext> {
  const fullSite = options.fullSite === true;
  const requestedUrl = value.trim();
  if (!requestedUrl) return EMPTY_CONTEXT;
  const normalized = normalizePublicUrl(requestedUrl);
  if (!normalized) return { ...EMPTY_CONTEXT, requestedUrl, status: "blocked" };
  const key = `${normalized.toString()}|${fullSite ? "full" : "standard"}`;
  const cached = websiteContextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) websiteContextCache.delete(key);

  const active = websiteContextInFlight.get(key);
  if (active) return active;

  const pending = loadWebsiteContext(requestedUrl, fullSite).then((context) => {
    if (websiteContextCache.size >= WEBSITE_CACHE_MAX_ENTRIES) {
      const oldestKey = websiteContextCache.keys().next().value;
      if (oldestKey) websiteContextCache.delete(oldestKey);
    }
    const ttl = context.status === "loaded" ? WEBSITE_CACHE_TTL_MS : WEBSITE_FAILURE_CACHE_TTL_MS;
    websiteContextCache.set(key, { value: context, expiresAt: Date.now() + ttl });
    return context;
  }).finally(() => {
    websiteContextInFlight.delete(key);
  });
  websiteContextInFlight.set(key, pending);
  return pending;
}

export function websiteSourceLabel(context: WebsiteContext) {
  if (context.status === "loaded") return `прочитаны открытые страницы сайта ${context.resolvedUrl || context.requestedUrl}`;
  if (context.status === "blocked") return "адрес сайта отклонён проверкой безопасности";
  if (context.status === "unavailable") return "страница сайта недоступна — использованы заполненные поля профиля";
  return "сайт не указан — использованы заполненные поля профиля";
}
