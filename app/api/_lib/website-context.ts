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

const MAX_REDIRECTS = 5;

// Follows redirects manually (redirect: "manual") so every hop — not just
// the URL the visitor typed — is re-checked against normalizePublicUrl().
// With redirect: "follow", a public-looking URL that later 30x's to a
// private/internal address (loopback, link-local metadata, LAN) would be
// fetched server-side without ever re-running the private-IP guard.
async function fetchPublicHtml(url: URL) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "KLIO-Brand-Context/1.0",
      },
      signal: AbortSignal.timeout(4_500),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      const next = normalizePublicUrl(new URL(location, current).toString());
      if (!next) return null;
      current = next;
      continue;
    }

    return response;
  }
  return null;
}

export async function readWebsiteContext(value: string): Promise<WebsiteContext> {
  const requestedUrl = value.trim();
  if (!requestedUrl) return EMPTY_CONTEXT;
  const url = normalizePublicUrl(requestedUrl);
  if (!url) return { ...EMPTY_CONTEXT, requestedUrl, status: "blocked" };

  try {
    const response = await fetchPublicHtml(url);
    if (!response) return { ...EMPTY_CONTEXT, requestedUrl, resolvedUrl: url.toString(), status: "blocked" };
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ...EMPTY_CONTEXT, requestedUrl, resolvedUrl: response.url || url.toString(), status: "unavailable" };
    }

    const text = extractWebsiteText(await response.text());
    return {
      requestedUrl,
      resolvedUrl: response.url || url.toString(),
      status: text ? "loaded" : "unavailable",
      text,
    };
  } catch {
    return { ...EMPTY_CONTEXT, requestedUrl, resolvedUrl: url.toString(), status: "unavailable" };
  }
}

export function websiteSourceLabel(context: WebsiteContext) {
  if (context.status === "loaded") return `открытая страница ${context.resolvedUrl || context.requestedUrl} прочитана`;
  if (context.status === "blocked") return "адрес сайта отклонён проверкой безопасности";
  if (context.status === "unavailable") return "страница сайта недоступна — использованы заполненные поля профиля";
  return "сайт не указан — использованы заполненные поля профиля";
}
