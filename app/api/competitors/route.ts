import { readWebsiteContext, websiteSourceLabel, type WebsiteContext } from "../_lib/website-context";
import { AiResponseError, openAiErrorResponse } from "../_lib/openai-response";
import { callAiModel } from "../_lib/ai-router";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";

type CompetitorCoverage = "strong" | "partial" | "missing" | "unknown";

type CompetitorInput = {
  id: string;
  label: string;
  url: string;
};

type CompetitorSource = CompetitorInput & {
  status: "loaded" | "unavailable" | "blocked";
};

type SemanticKeywordInput = {
  phrase: string;
  cluster: string;
  role: string;
};

type BrandInput = {
  name: string;
  website: string;
  description: string;
  positioning: string;
  audience: string;
  advantages: string;
};

type CompetitorPayload = {
  query?: unknown;
  competitors?: unknown;
  semanticKeywords?: unknown;
  brand?: unknown;
};

type AiTopic = {
  title: string;
  cluster: string;
  priority: "Высокий" | "Средний" | "Дополнительный";
  rationale: string;
  brand_coverage: CompetitorCoverage;
  brand_evidence: string;
  competitor_coverage: { competitor_id: string; coverage: CompetitorCoverage; evidence: string }[];
  opportunity: string;
  recommended: boolean;
};

type AiAnalysis = {
  suggestedTitle: string;
  topics: AiTopic[];
};

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const NON_COMPETITOR_DOMAINS = [
  "google.com", "yandex.ru", "bing.com", "wikipedia.org", "youtube.com", "vk.com", "t.me",
  "tripadvisor.ru", "tripadvisor.com", "booking.com", "2gis.ru", "zoon.ru", "dzen.ru",
  "kp.ru", "aif.ru", "ria.ru", "tass.ru", "interfax.ru", "rbc.ru", "otzovik.com", "irecommend.ru",
  "puteveka.com", "putevka.com",
];

function domainOf(value: string) {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isAllowedCompetitorUrl(url: string, brandDomain: string) {
  const domain = domainOf(url);
  return Boolean(domain)
    && domain !== brandDomain
    && !NON_COMPETITOR_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function cleanBrand(value: unknown): BrandInput {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    name: clean(source.name, 160),
    website: clean(source.website, 220),
    description: clean(source.description, 1800),
    positioning: clean(source.positioning, 1400),
    audience: clean(source.audience, 1200),
    advantages: clean(source.advantages, 1800),
  };
}

function cleanCompetitors(value: unknown): CompetitorInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((item, index) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: clean(source.id, 90) || `competitor-${index + 1}`,
      label: clean(source.label, 120) || `Конкурент ${index + 1}`,
      url: clean(source.url, 500),
    };
  }).filter((item) => item.url);
}

function cleanSemanticKeywords(value: unknown): SemanticKeywordInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      phrase: clean(source.phrase, 180),
      cluster: clean(source.cluster, 100),
      role: clean(source.role, 60),
    };
  }).filter((item) => item.phrase);
}

function sourceStatus(context: WebsiteContext): CompetitorSource["status"] {
  if (context.status === "loaded") return "loaded";
  if (context.status === "blocked") return "blocked";
  return "unavailable";
}

function hasEvidence(text: string, evidence: string) {
  const sourceTokens = new Set(text.toLocaleLowerCase("ru-RU").match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  const evidenceTokens = [...new Set(evidence.toLocaleLowerCase("ru-RU").match(/[\p{L}\p{N}]{4,}/gu) ?? [])];
  return evidenceTokens.filter((token) => sourceTokens.has(token)).length >= 2;
}

function verifiedCoverage(coverage: CompetitorCoverage | undefined, evidence: string, text: string, available: boolean): CompetitorCoverage {
  if (!available || text.length < 900) return "unknown";
  if (coverage === "strong" || coverage === "partial") return hasEvidence(text, evidence) ? coverage : "unknown";
  if (coverage === "missing") return "missing";
  return "unknown";
}

function analysisSchema(competitorIds: string[]) {
  return {
    type: "object",
    properties: {
      suggestedTitle: { type: "string" },
      topics: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            cluster: { type: "string" },
            priority: { type: "string", enum: ["Высокий", "Средний", "Дополнительный"] },
            rationale: { type: "string" },
            brand_coverage: { type: "string", enum: ["strong", "partial", "missing", "unknown"] },
            brand_evidence: { type: "string" },
            competitor_coverage: {
              type: "array",
              minItems: competitorIds.length,
              maxItems: competitorIds.length,
              items: {
                type: "object",
                properties: {
                  competitor_id: { type: "string", enum: competitorIds },
                  coverage: { type: "string", enum: ["strong", "partial", "missing", "unknown"] },
                  evidence: { type: "string" },
                },
                required: ["competitor_id", "coverage", "evidence"],
                additionalProperties: false,
              },
            },
            opportunity: { type: "string" },
            recommended: { type: "boolean" },
          },
          required: ["title", "cluster", "priority", "rationale", "brand_coverage", "brand_evidence", "competitor_coverage", "opportunity", "recommended"],
          additionalProperties: false,
        },
      },
    },
    required: ["suggestedTitle", "topics"],
    additionalProperties: false,
  };
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as CompetitorPayload;
    const query = clean(payload.query, 220);
    const rawCompetitors = cleanCompetitors(payload.competitors);
    const semanticKeywords = cleanSemanticKeywords(payload.semanticKeywords);
    const brand = cleanBrand(payload.brand);
    const brandDomain = domainOf(brand.website);
    const competitors = rawCompetitors.filter((item) => isAllowedCompetitorUrl(item.url, brandDomain));

    if (!query) return Response.json({ error: "Укажите тему или основной запрос." }, { status: 400 });
    if (competitors.length !== rawCompetitors.length) {
      return Response.json({ error: "В сравнении нельзя использовать сайт бренда, агрегаторы, каталоги, СМИ, отзывы или социальные сети. Оставьте только прямые страницы компаний-конкурентов." }, { status: 400 });
    }
    if (competitors.length < 2) return Response.json({ error: "Добавьте минимум две страницы конкурентов." }, { status: 400 });
    await assertSecondaryQuotaAvailable("research");
    const identity = await workspaceIdentity();

    const [brandWebsite, competitorWebsites] = await Promise.all([
      readWebsiteContext(brand.website),
      Promise.all(competitors.map((item) => readWebsiteContext(item.url))),
    ]);

    const sources: CompetitorSource[] = competitors.map((item, index) => ({
      ...item,
      url: competitorWebsites[index].resolvedUrl || item.url,
      status: sourceStatus(competitorWebsites[index]),
    }));
    const brandText = [brand.description, brand.positioning, brand.audience, brand.advantages, brandWebsite.text].filter(Boolean).join("\n").slice(0, 10_000);
    const brandStatus: WebsiteContext["status"] | "profile" = brandText ? "profile" : brandWebsite.status;

    const requestContext = {
      comparison_topic: query,
      semantic_context: semanticKeywords.length ? semanticKeywords : null,
      brand: brand.name ? { name: brand.name, status: brandStatus, text: brandText || null } : null,
      competitors: sources.map((source, index) => ({
        id: source.id,
        label: source.label,
        status: source.status,
        text: competitorWebsites[index].status === "loaded" ? competitorWebsites[index].text.slice(0, 10_000) : null,
      })),
    };

    const instructions = [
      "Ты — senior SEO-стратег КЛИО. Проведи настоящий контентный анализ прямых конкурентов по факту прочитанных страниц — не используй шаблонный список тем из другой отрасли.",
      "Сравниваются только самостоятельные компании с сопоставимым предложением. Не оценивай редакционные статьи, агрегаторы, отзывы или посредников как конкурентов; если источник недоступен, честно пометь его coverage как unknown и не достраивай сведения.",
      "Сначала определи 6–10 тем, которые реально важны именно для этой темы/категории/индустрии и её аудитории, основываясь на comparison_topic, semantic_context (если передан) и содержимом прочитанных страниц. Темы должны быть предметными, а не абстрактными («Критерии выбора» без конкретики запрещены).",
      "Для каждой темы классифицируй brand_coverage и coverage каждого конкурента строго по факту: strong — тема развёрнуто раскрыта в тексте; partial — упомянута кратко или косвенно; missing — текст прочитан, но темы нет; unknown — текст этого источника не был доступен (status не loaded/profile). Никогда не ставь unknown, если текст источника передан, и никогда не угадывай содержимое источника с status не loaded.",
      "rationale объясняет, почему тема важна именно для этого запроса и аудитории. opportunity — конкретное редакционное действие: что раскрыть, усилить или проверить, с опорой на реальный разрыв между источниками, а не общая фраза.",
      "recommended = true только для реальной возможности создать НОВЫЙ материал: тема у бренда должна быть missing или partial, а на доступной странице хотя бы одного прямого конкурента — strong или partial. Если тема у бренда уже strong, не рекомендуй отдельную статью по ней: это риск дубля и каннибализации. В таком случае можно предложить улучшение текущей страницы, но не новую статью.",
      "Не давай медицинских, юридических или финансовых гарантий и не оценивай качество продуктов — только полноту раскрытия темы в тексте.",
      "suggestedTitle — конкретный заголовок будущего материала по comparison_topic, без общих формулировок вроде «Как выбрать X» если тема не про выбор.",
      "Верни только структурированный результат по JSON-схеме.",
      "Use only 3-8 topics that are supported by the supplied page texts. For strong or partial coverage, evidence must be a short exact fragment from that same source text. If the source text is too short or you cannot quote evidence, use unknown, never missing. missing is allowed only after a sufficiently detailed source text was supplied and the topic is genuinely absent.",
    ].join("\n");

    const { result: aiResult, model } = await callAiModel<AiAnalysis>({
      operation: "analyze_competitors",
      ownerEmail: identity.email,
      schemaName: "klio_competitor_analysis",
      schema: analysisSchema(sources.map((item) => item.id)),
      instructions,
      input: JSON.stringify(requestContext, null, 2),
    });

    if (!aiResult.topics?.length) {
      throw new AiResponseError("AI-аналитик не смог построить сравнение. Повторите попытку.", 422);
    }

    const topics = aiResult.topics.map((topic, index) => {
      const coverage = Object.fromEntries(
        sources.map((source) => {
          const match = topic.competitor_coverage.find((item) => item.competitor_id === source.id);
          const sourceIndex = sources.findIndex((item) => item.id === source.id);
          return [source.id, verifiedCoverage(match?.coverage, match?.evidence ?? "", competitorWebsites[sourceIndex]?.text ?? "", source.status === "loaded")];
        }),
      ) as Record<string, CompetitorCoverage>;
      const coverageEvidence = Object.fromEntries(sources.map((source) => {
        const match = topic.competitor_coverage.find((item) => item.competitor_id === source.id);
        return [source.id, clean(match?.evidence, 280)];
      }));
      const brandCoverage = brand.name
        ? verifiedCoverage(topic.brand_coverage, topic.brand_evidence, brandText, Boolean(brandText))
        : "unknown" as CompetitorCoverage;
      const hasCompetitorCoverage = Object.values(coverage).some((value) => value === "strong" || value === "partial");
      const isArticleOpportunity = (brandCoverage === "missing" || brandCoverage === "partial") && hasCompetitorCoverage;
      return {
        id: `topic-${index + 1}`,
        title: clean(topic.title, 200) || `Тема ${index + 1}`,
        cluster: clean(topic.cluster, 100) || "Основная тема",
        priority: topic.priority,
        rationale: clean(topic.rationale, 500),
        brandCoverage,
        brandEvidence: clean(topic.brand_evidence, 280),
        coverage,
        coverageEvidence,
        opportunity: clean(topic.opportunity, 500),
        // A model label is never sufficient on its own: a new article makes
        // sense only where the active brand actually has a verified gap.
        recommended: Boolean(topic.recommended) && isArticleOpportunity,
      };
    });

    const loadedSources = sources.filter((item) => item.status === "loaded");
    const commonTopics = loadedSources.length
      ? topics.filter((topic) => {
        const covered = loadedSources.filter((source) => topic.coverage[source.id] === "strong" || topic.coverage[source.id] === "partial").length;
        return covered >= Math.ceil(loadedSources.length / 2);
      }).slice(0, 5).map((topic) => topic.title)
      : [];
    const gaps = topics.filter((topic) => topic.recommended).slice(0, 5).map((topic) => topic.title);
    const suggestedStructure = topics
      .filter((topic) => topic.recommended)
      .sort((left, right) => (left.priority === "Высокий" ? -1 : 0) - (right.priority === "Высокий" ? -1 : 0))
      .slice(0, 6)
      .map((topic) => topic.title);
    const loadedCount = loadedSources.length;
    const unavailableCount = sources.length - loadedCount;
    const dataNote = [
      `Прочитано страниц: ${loadedCount} из ${sources.length}.`,
      unavailableCount ? `${unavailableCount} ${unavailableCount === 1 ? "источник помечен" : "источника помечены"} как непроверенные и не считаются пустыми.` : "Все указанные страницы доступны для анализа.",
      `Профиль бренда: ${websiteSourceLabel(brandWebsite)}.`,
      "Сравнение построено ИИ по фактическому тексту страниц, а не по шаблону тем; оценка качества медицинских, юридических или коммерческих утверждений не проводится.",
    ].join(" ");

    const usage = await recordResearch();
    return Response.json({
      mode: "ai",
      model,
      usage,
      result: {
        query,
        competitors: sources,
        topics,
        commonTopics,
        gaps,
        suggestedTitle: clean(aiResult.suggestedTitle, 200) || query,
        suggestedStructure,
        dataNote,
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось прочитать страницы и построить матрицу.");
  }
}
