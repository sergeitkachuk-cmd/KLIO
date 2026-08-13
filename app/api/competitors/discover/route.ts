import { AiCallError, callAiModel } from "../../_lib/ai-router";
import { aiConfigured } from "../../_lib/ai-config";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { readWebsiteContext } from "../../_lib/website-context";

type BrandInput = {
  name: string;
  website: string;
  description: string;
  positioning: string;
  audience: string;
};

type GeographyInput = {
  label: string;
  detail: string;
};

type DiscoverPayload = {
  query?: unknown;
  brand?: unknown;
  geography?: unknown;
};

type Citation = {
  title: string;
  url: string;
  searchRank?: number;
};

type CandidateSelection = {
  candidates: { candidate_id: string; name: string; segment: "industry_leader" | "regional_competitor" | "market_competitor"; reason: string }[];
  rejected: { candidate_id: string; kind: "aggregator" | "editorial" | "unrelated"; reason: string }[];
};

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanBrand(value: unknown): BrandInput {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    name: clean(source.name, 160),
    website: clean(source.website, 220),
    description: clean(source.description, 1000),
    positioning: clean(source.positioning, 900),
    audience: clean(source.audience, 700),
  };
}

function cleanGeography(value: unknown): GeographyInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      label: clean(source.label, 140),
      detail: clean(source.detail, 180),
    };
  }).filter((item) => item.label);
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function domainOf(value: string) {
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(normalized).hostname.toLocaleLowerCase("ru-RU").replace(/^www\./, "");
  } catch {
    return "";
  }
}

function readableDomain(value: string) {
  return domainOf(value) || "Найденная страница";
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function yandexSearch(query: string): Promise<Citation[]> {
  const apiKey = process.env.YANDEX_SEARCH_API_KEY?.trim();
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  if (!apiKey || !folderId || !query) return [];

  try {
    const response = await fetch("https://searchapi.api.cloud.yandex.net/v2/web/search", {
      method: "POST",
      headers: { Authorization: `Api-Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId,
        responseFormat: "FORMAT_XML",
        query: { searchType: "SEARCH_TYPE_RU", queryText: query, familyMode: "FAMILY_MODE_STRICT" },
        groupingSpec: { groupMode: "GROUP_MODE_FLAT", groupsOnPage: 20, docsInGroup: 1 },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.warn("Yandex Search API competitor lookup failed", response.status);
      return [];
    }
    const payload = await response.json() as { rawData?: unknown };
    if (typeof payload.rawData !== "string") return [];
    const xml = Buffer.from(payload.rawData, "base64").toString("utf8");
    const result: Citation[] = [];
    for (const [index, block] of [...xml.matchAll(/<doc[\s\S]*?<\/doc>/gi)].entries()) {
      const url = normalizeUrl(decodeXml(block[0].match(/<url>([\s\S]*?)<\/url>/i)?.[1] || ""));
      if (!url) continue;
      const title = decodeXml(block[0].match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "")
        .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      result.push({ url, title: title || readableDomain(url), searchRank: index + 1 });
    }
    return result;
  } catch (error) {
    console.warn("Yandex Search API competitor lookup failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function marketQuery(query: string, brand: BrandInput) {
  const brandName = brand.name.toLocaleLowerCase("ru-RU");
  const requested = query.toLocaleLowerCase("ru-RU");
  // A brand-name-only request returns pages that mention that brand. Use the
  // profile's category/positioning as the market query in that one case.
  if (brandName && requested.includes(brandName) && (brand.positioning || brand.description)) {
    return (brand.positioning || brand.description).replace(/\s+/g, " ").slice(0, 220);
  }
  return query;
}

function responseText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const source = response as { output_text?: unknown; output?: unknown };
  if (typeof source.output_text === "string") return source.output_text;
  if (!Array.isArray(source.output)) return "";
  return source.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? (part as { text: string }).text
      : "");
  }).filter(Boolean).join("\n");
}

function citationsFromResponse(response: unknown): Citation[] {
  if (!response || typeof response !== "object") return [];
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return [];

  const citations: Citation[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const typedItem = item as { type?: unknown; content?: unknown; action?: unknown };

    if (typedItem.type === "message" && Array.isArray(typedItem.content)) {
      for (const part of typedItem.content) {
        if (!part || typeof part !== "object") continue;
        const annotations = (part as { annotations?: unknown }).annotations;
        if (!Array.isArray(annotations)) continue;
        for (const annotation of annotations) {
          if (!annotation || typeof annotation !== "object") continue;
          const typedAnnotation = annotation as {
            type?: unknown;
            title?: unknown;
            url?: unknown;
            url_citation?: { title?: unknown; url?: unknown };
          };
          const nested = typedAnnotation.url_citation;
          const url = normalizeUrl(clean(typedAnnotation.url ?? nested?.url, 700));
          if (!url || typedAnnotation.type !== "url_citation") continue;
          citations.push({
            url,
            title: clean(typedAnnotation.title ?? nested?.title, 180) || readableDomain(url),
          });
        }
      }
    }

    if (typedItem.type === "web_search_call" && typedItem.action && typeof typedItem.action === "object") {
      const sources = (typedItem.action as { sources?: unknown }).sources;
      if (!Array.isArray(sources)) continue;
      for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        const url = normalizeUrl(clean((source as { url?: unknown }).url, 700));
        if (url) citations.push({ url, title: readableDomain(url) });
      }
    }
  }
  return citations;
}

const NON_COMPETITOR_DOMAINS = [
  "google.com",
  "yandex.ru",
  "bing.com",
  "wikipedia.org",
  "youtube.com",
  "vk.com",
  "t.me",
  "tripadvisor.ru",
  "tripadvisor.com",
  "booking.com",
  "kp.ru",
  "aif.ru",
  "ria.ru",
  "tass.ru",
  "interfax.ru",
  "rbc.ru",
  "otzovik.com",
  "irecommend.ru",
  "puteveka.com",
  "putevka.com",
  "2gis.ru",
  "zoon.ru",
  "dzen.ru",
];

function isDirectCandidate(url: string, brandDomain: string) {
  const domain = domainOf(url);
  if (!domain || (brandDomain && domain === brandDomain)) return false;
  return !NON_COMPETITOR_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function selectionSchema(candidateIds: string[]) {
  return {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        minItems: 0,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            candidate_id: { type: "string", enum: candidateIds },
            name: { type: "string" },
            segment: { type: "string", enum: ["industry_leader", "regional_competitor", "market_competitor"] },
            reason: { type: "string" },
          },
          required: ["candidate_id", "name", "segment", "reason"],
          additionalProperties: false,
        },
      },
      rejected: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            candidate_id: { type: "string", enum: candidateIds },
            kind: { type: "string", enum: ["aggregator", "editorial", "unrelated"] },
            reason: { type: "string" },
          },
          required: ["candidate_id", "kind", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["candidates", "rejected"],
    additionalProperties: false,
  } as const;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as DiscoverPayload;
    const query = clean(payload.query, 260);
    const brand = cleanBrand(payload.brand);
    const geography = cleanGeography(payload.geography);

    if (!query && !brand.description && !brand.positioning) {
      return Response.json({ error: "Укажите тему либо заполните описание и позиционирование бренда." }, { status: 400 });
    }

    // Two real Luna calls (one with forced web_search) plus a Yandex Search
    // call and up to 20 page fetches per request — metered like every other
    // research route so this endpoint can't be looped for unbounded spend.
    await assertSecondaryQuotaAvailable("research");

    if (!aiConfigured()) {
      return Response.json({ error: "Автоподбор требует подключённого AI‑доступа. Пока добавьте ссылки вручную." }, { status: 503 });
    }

    const identity = await workspaceIdentity();
    const brief = JSON.stringify({
      comparison_topic: query,
      brand: brand.name ? brand : null,
      search_demand_geography: geography,
    }, null, 2);

    let responseBody: unknown;
    let model = "";
    let yandexResults: Citation[] = [];
    try {
      // yandexSearch never throws (it catches internally and resolves to
      // []), so Promise.all's rejection can only come from callAiModel —
      // the catch below keeps the exact same AiCallError handling as before,
      // it just no longer waits for the AI call before starting the
      // independent Yandex Search request.
      const [call, yandex] = await Promise.all([
        callAiModel({
          operation: "discover_competitors",
          ownerEmail: identity.email,
          toolChoice: "required",
          includeSources: true,
          instructions: [
            "Ты находишь прямых контентных конкурентов для сравнительной матрицы КЛИО.",
            "Обязательно выполни веб‑поиск по категории, услуге и поисковому интенту, а не только по названию бренда. Найди 5–10 открытых страниц реальных компаний по той же теме.",
            "Нужны именно страницы продуктов, услуг, программ или содержательные тематические страницы прямых конкурентов.",
            "Не предлагай сайт бренда, его зеркала, страницы с упоминанием бренда, поисковую выдачу, агрегаторы, каталоги, карты, соцсети, энциклопедии, отзывы, новости и редакционные публикации.",
            "Если география указана, используй её как территорию целевого спроса, а не как неподтверждённое местонахождение бренда.",
            "Для каждого кандидата напиши отдельный короткий пункт: название страницы и почему она релевантна. Каждый пункт обязан содержать кликабельную веб‑цитату.",
            "Не придумывай адреса и не перечисляй страницы, которые не были найдены веб‑поиском.",
          ].join("\n"),
          input: `Найди страницы конкурентов по этому брифу:\n${brief}`,
        }),
        yandexSearch(marketQuery(query, brand)),
      ]);
      responseBody = call.rawResponse;
      model = call.model;
      yandexResults = yandex;
    } catch (error) {
      if (error instanceof AiCallError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const brandDomain = domainOf(brand.website);
    const seen = new Set<string>();
    const pool = [...yandexResults, ...citationsFromResponse(responseBody)]
      .filter((item) => isDirectCandidate(item.url, brandDomain))
      .filter((item) => {
        const key = domainOf(item.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20)
      .map((item, index) => ({ id: `candidate-${index + 1}`, ...item }));

    if (pool.length < 2) {
      console.warn("Competitor discovery returned too few direct candidates", responseText(responseBody).slice(0, 800));
      return Response.json({ error: "ИИ нашёл менее двух подходящих прямых страниц. Уточните тему или добавьте ссылки вручную." }, { status: 422 });
    }

    const pageContexts = await Promise.all(pool.map((item) => readWebsiteContext(item.url)));
    const readablePool = pool.map((item, index) => ({
      id: item.id,
      domain: readableDomain(item.url),
      search_title: item.title,
      url: item.url,
      search_rank: item.searchRank ?? null,
      status: pageContexts[index].status,
      page_text: pageContexts[index].status === "loaded" ? pageContexts[index].text.slice(0, 5000) : "",
    })).filter((item) => item.status === "loaded" && item.page_text);

    if (readablePool.length < 2) {
      return Response.json({ error: "Не удалось прочитать минимум две страницы компаний. Попробуйте ещё раз или добавьте прямые ссылки на сайты конкурентов." }, { status: 422 });
    }

    const selection = await callAiModel<CandidateSelection>({
      operation: "analyze_competitors",
      ownerEmail: identity.email,
      schemaName: "klio_direct_competitor_selection",
      schema: selectionSchema(readablePool.map((item) => item.id)),
      instructions: [
        "Ты проверяешь кандидатов для сравнительной матрицы КЛИО. Отбери только прямых конкурентов активного бренда.",
        "Прямой конкурент — самостоятельная компания или объект размещения, который предлагает сопоставимую услугу той же аудитории и может конкурировать за тот же спрос.",
        "Допускай только собственную содержательную страницу предложения, услуги, программы или тематическую страницу такой компании.",
        "Строго исключай: сайт активного бренда и его зеркала; страницы, которые лишь упоминают бренд; агрегаторы, турагрегаторы, каталоги, карты, СМИ, новости, обзоры, отзывы, карточки бронирования и любые посреднические страницы.",
        "Опирайся только на переданные URL и page_text. Не угадывай тип страницы. Если подходящих компаний меньше двух, не возвращай неподходящие варианты ради количества.",
        "segment=industry_leader ставь сильному участнику отрасли, заметному в верхней части поисковой выдачи или явно значимому для темы. segment=market_competitor ставь компании, которые ближе всего конкурируют за выбранную аудиторию и запрос. Для каждого кандидата дай короткую причину на основе его страницы. Не выбирай более одной страницы одного домена.",
        "Segment contract: use industry_leader only for a strong company visible in the general search results for this demand. If a target geography is supplied and the page clearly serves that geography, use regional_competitor. Use market_competitor for another direct competitor. These are discovery labels, not a quality score and not a measured SEO position. Do not label an organisation regional only because its postal address happens to be there.",
        "Select up to five verified direct competitors from the supplied candidates. Return fewer only when fewer than five candidates actually qualify. name must be the familiar company or property name, never a domain name. reason must be one short, plain-language sentence explaining why this company is relevant to the same customer demand; do not write a generic list of its services.",
        "For every readable candidate that you do not select, add it to rejected. Use aggregator for marketplaces, booking platforms, tour operators and resellers, editorial for media/reviews/articles, and unrelated for other non-comparable pages. These rejected pages must never enter the competitor matrix.",
      ].join("\n"),
      input: JSON.stringify({ comparison_topic: query, active_brand: brand.name ? { name: brand.name, website: brand.website } : null, target_geography: geography, candidates: readablePool }),
    });

    const poolById = new Map(pool.map((item) => [item.id, item]));
    const selectedIds = new Set<string>();
    const candidates = selection.result.candidates
      .filter((item) => !selectedIds.has(item.candidate_id) && Boolean(poolById.get(item.candidate_id)))
      .map((item) => {
        selectedIds.add(item.candidate_id);
        const candidate = poolById.get(item.candidate_id)!;
        const confirmedLeader = typeof candidate.searchRank === "number" && candidate.searchRank <= 5;
        return {
          id: `ai-${Date.now()}-${selectedIds.size}`,
          label: clean(item.name, 120) || clean(candidate.title, 120) || readableDomain(candidate.url),
          url: candidate.url,
          origin: "ai" as const,
          segment: confirmedLeader ? "industry_leader" as const : item.segment,
          note: clean(item.reason, 260),
        };
      });

    if (candidates.length < 2) {
      return Response.json({ error: "По найденным страницам не удалось подтвердить минимум двух прямых конкурентов. Уточните категорию или добавьте сайты конкурентов вручную." }, { status: 422 });
    }

    const selectedDomains = new Set(candidates.map((item) => domainOf(item.url)));
    const rejectedByDomain = new Map(selection.result.rejected.map((item) => {
      const candidate = poolById.get(item.candidate_id);
      return [candidate ? domainOf(candidate.url) : "", item.kind] as const;
    }));
    const serp = yandexResults.slice(0, 10).map((item, index) => {
      const domain = domainOf(item.url);
      return {
        rank: item.searchRank ?? index + 1,
        title: clean(item.title, 180) || readableDomain(item.url),
        url: item.url,
        kind: brandDomain && domain === brandDomain
          ? "brand"
          : selectedDomains.has(domain)
            ? "competitor"
            : rejectedByDomain.get(domain) === "aggregator"
              ? "aggregator"
            : isDirectCandidate(item.url, brandDomain)
              ? "candidate"
              : "other",
      };
    });

    const usage = await recordResearch();
    return Response.json({ candidates, serp, mode: "ai", model: selection.model || model, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Competitor discovery route failed", error);
    return Response.json({ error: "Не удалось выполнить поиск конкурентов. Попробуйте ещё раз или добавьте ссылки вручную." }, { status: 500 });
  }
}
