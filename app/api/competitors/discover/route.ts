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
  "2gis.ru",
  "zoon.ru",
  "dzen.ru",
];

function isDirectCandidate(url: string, brandDomain: string) {
  const domain = domainOf(url);
  if (!domain || (brandDomain && domain === brandDomain)) return false;
  return !NON_COMPETITOR_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
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

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return Response.json({ error: "Автоподбор требует подключённого AI‑доступа. Пока добавьте ссылки вручную." }, { status: 503 });
    }

    const model = process.env.OPENAI_SEARCH_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
    const brief = JSON.stringify({
      comparison_topic: query,
      brand: brand.name ? brand : null,
      search_demand_geography: geography,
    }, null, 2);

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 1800,
        text: { verbosity: "low" },
        tools: [{ type: "web_search", search_context_size: "medium" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        instructions: [
          "Ты находишь прямых контентных конкурентов для сравнительной матрицы КЛИО.",
          "Обязательно выполни веб‑поиск и найди 3–5 открытых страниц реальных компаний по той же теме, категории и поисковому интенту.",
          "Нужны именно страницы продуктов, услуг, программ или содержательные тематические страницы прямых конкурентов.",
          "Не предлагай поисковую выдачу, агрегаторы, каталоги, карты, соцсети, энциклопедии, новостные публикации и сайт самого бренда.",
          "Если география указана, используй её как территорию целевого спроса, а не как неподтверждённое местонахождение бренда.",
          "Для каждого кандидата напиши отдельный короткий пункт: название страницы и почему она релевантна. Каждый пункт обязан содержать кликабельную веб‑цитату.",
          "Не придумывай адреса и не перечисляй страницы, которые не были найдены веб‑поиском.",
        ].join("\n"),
        input: `Найди страницы конкурентов по этому брифу:\n${brief}`,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Competitor discovery failed", aiResponse.status, errorText.slice(0, 1200));
      return Response.json({ error: "ИИ‑поиск временно не ответил. Ссылки можно добавить вручную." }, { status: 502 });
    }

    const responseBody = await aiResponse.json();
    const brandDomain = domainOf(brand.website);
    const seen = new Set<string>();
    const candidates = citationsFromResponse(responseBody)
      .filter((item) => isDirectCandidate(item.url, brandDomain))
      .filter((item) => {
        const key = `${domainOf(item.url)}${new URL(item.url).pathname.replace(/\/$/, "")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5)
      .map((item, index) => ({
        id: `ai-${Date.now()}-${index + 1}`,
        label: item.title || readableDomain(item.url),
        url: item.url,
        origin: "ai" as const,
      }));

    if (candidates.length < 2) {
      console.warn("Competitor discovery returned too few direct candidates", responseText(responseBody).slice(0, 800));
      return Response.json({ error: "ИИ нашёл менее двух подходящих прямых страниц. Уточните тему или добавьте ссылки вручную." }, { status: 422 });
    }

    return Response.json({ candidates, mode: "ai", model });
  } catch (error) {
    console.error("Competitor discovery route failed", error);
    return Response.json({ error: "Не удалось выполнить поиск конкурентов. Попробуйте ещё раз или добавьте ссылки вручную." }, { status: 500 });
  }
}
