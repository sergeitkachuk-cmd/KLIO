import { readWebsiteContext, websiteSourceLabel, type WebsiteContext } from "../_lib/website-context";
import { assertSecondaryQuotaAvailable, recordResearch, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";

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

type TopicDefinition = {
  id: string;
  title: string;
  cluster: string;
  priority: "Высокий" | "Средний" | "Дополнительный";
  rationale: string;
  keywords: string[];
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

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
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

function coverageFor(text: string, status: WebsiteContext["status"] | "profile", keywords: string[]): CompetitorCoverage {
  if (status !== "loaded" && status !== "profile") return "unknown";
  const haystack = normalize(text);
  const matches = [...new Set(keywords.map(normalize).filter(Boolean))]
    .filter((keyword) => haystack.includes(keyword)).length;
  if (matches >= Math.min(2, Math.max(1, keywords.length))) return "strong";
  if (matches === 1) return "partial";
  return "missing";
}

function sanatoriumTopics(): TopicDefinition[] {
  return [
    {
      id: "choice",
      title: "Критерии выбора санатория",
      cluster: "Выбор",
      priority: "Высокий",
      rationale: "Напрямую отвечает на поисковый интент и помогает сопоставить варианты.",
      keywords: ["как выбрать", "критерии выбора", "на что обратить внимание", "сравнить санатор"],
    },
    {
      id: "medical",
      title: "Медицинский профиль и специалисты",
      cluster: "Лечение",
      priority: "Высокий",
      rationale: "Помогает понять, соответствует ли предложение задаче восстановления.",
      keywords: ["медицинский профиль", "врач", "специалист", "консультац", "диагност"],
    },
    {
      id: "program",
      title: "Состав программы и процедур",
      cluster: "Лечение",
      priority: "Высокий",
      rationale: "Одна из главных тем на этапе выбора и сравнения путёвок.",
      keywords: ["программа", "процедур", "назначен", "курс лечения", "путевк"],
    },
    {
      id: "nature",
      title: "Природные лечебные факторы",
      cluster: "Преимущества",
      priority: "Средний",
      rationale: "Отделяет курортное предложение от обычного размещения и отдыха.",
      keywords: ["лечебная вода", "минеральная вода", "лечебные гряз", "природные фактор", "бальнеолог"],
    },
    {
      id: "indications",
      title: "Показания и ограничения",
      cluster: "Безопасность",
      priority: "Высокий",
      rationale: "Снижает риск завышенных ожиданий и помогает подготовиться к консультации.",
      keywords: ["показан", "противопоказан", "ограничен", "не рекомендуется", "консультация врача"],
    },
    {
      id: "documents",
      title: "Документы и подготовка к поездке",
      cluster: "Подготовка",
      priority: "Средний",
      rationale: "Закрывает практические вопросы до бронирования и заезда.",
      keywords: ["санаторно-курортная карта", "документ", "справк", "что взять", "подготов"],
    },
    {
      id: "duration",
      title: "Длительность курса",
      cluster: "Условия",
      priority: "Средний",
      rationale: "Помогает оценить формат поездки и реалистичность программы.",
      keywords: ["длительность", "продолжительность", "дней", "суток", "срок курса"],
    },
    {
      id: "accommodation",
      title: "Проживание и питание",
      cluster: "Условия",
      priority: "Дополнительный",
      rationale: "Дополняет медицинскую часть бытовыми критериями выбора.",
      keywords: ["проживан", "номер", "корпус", "питание", "столов"],
    },
    {
      id: "booking",
      title: "Стоимость и условия бронирования",
      cluster: "Решение",
      priority: "Средний",
      rationale: "Поддерживает коммерческую часть интента и следующий шаг читателя.",
      keywords: ["стоимость", "цена", "забронировать", "бронирован", "свободные даты"],
    },
    {
      id: "faq",
      title: "Ответы на частые вопросы",
      cluster: "Подготовка",
      priority: "Дополнительный",
      rationale: "Собирает оставшиеся сомнения без перегрузки основной структуры.",
      keywords: ["частые вопросы", "вопросы и ответы", "faq", "можно ли", "что входит"],
    },
  ];
}

function genericTopics(query: string, semanticKeywords: SemanticKeywordInput[]): TopicDefinition[] {
  const queryTokens = normalize(query).split(/[^a-zа-я0-9]+/i).filter((item) => item.length >= 4).slice(0, 5);
  const clusterPhrases = new Map<string, string[]>();
  for (const keyword of semanticKeywords) {
    if (!keyword.cluster || keyword.cluster === "География") continue;
    const current = clusterPhrases.get(keyword.cluster) ?? [];
    current.push(keyword.phrase);
    clusterPhrases.set(keyword.cluster, current);
  }

  const base: TopicDefinition[] = [
    {
      id: "core",
      title: "Прямой ответ по основной теме",
      cluster: "Основная тема",
      priority: "Высокий",
      rationale: "Показывает, отвечает ли страница на исходный запрос без длинного вступления.",
      keywords: [normalize(query), ...queryTokens],
    },
    {
      id: "choice",
      title: "Критерии выбора и сравнения",
      cluster: "Выбор",
      priority: "Высокий",
      rationale: "Помогает читателю перейти от изучения темы к осознанному решению.",
      keywords: ["как выбрать", "критерии", "сравнен", "на что обратить внимание", "вариант"],
    },
    {
      id: "benefit",
      title: "Польза и подтверждённые преимущества",
      cluster: "Ценность",
      priority: "Высокий",
      rationale: "Отделяет конкретную ценность от общих рекламных формулировок.",
      keywords: ["преимуществ", "польз", "помогает", "результат", "ценност"],
    },
    {
      id: "process",
      title: "Как устроен процесс",
      cluster: "Процесс",
      priority: "Средний",
      rationale: "Снимает неопределённость и показывает путь пользователя.",
      keywords: ["как работает", "этап", "процесс", "порядок", "шаг"],
    },
    {
      id: "conditions",
      title: "Условия и ограничения",
      cluster: "Условия",
      priority: "Средний",
      rationale: "Помогает оценить применимость предложения до обращения.",
      keywords: ["условия", "ограничен", "требован", "подходит", "необходимо"],
    },
    {
      id: "proof",
      title: "Факты и доказательства",
      cluster: "Доверие",
      priority: "Средний",
      rationale: "Показывает, чем страница подтверждает обещанную ценность.",
      keywords: ["опыт", "сертификат", "исследован", "пример", "кейс", "цифр"],
    },
    {
      id: "price",
      title: "Стоимость и состав предложения",
      cluster: "Решение",
      priority: "Средний",
      rationale: "Поддерживает коммерческий интент и снижает неопределённость.",
      keywords: ["стоимость", "цена", "тариф", "что входит", "заказать"],
    },
    {
      id: "faq",
      title: "Ответы на частые вопросы",
      cluster: "Вопросы",
      priority: "Дополнительный",
      rationale: "Закрывает сомнения, которые не требуют отдельного большого раздела.",
      keywords: ["частые вопросы", "вопросы и ответы", "faq", "можно ли", "почему"],
    },
  ];

  const semanticTopics = [...clusterPhrases.entries()].slice(0, 3).map(([cluster, phrases], index) => ({
    id: `semantic-${index + 1}`,
    title: cluster,
    cluster: "Семантика",
    priority: "Средний" as const,
    rationale: "Смысловая группа перенесена из выбранной семантики.",
    keywords: phrases.flatMap((phrase) => [normalize(phrase), ...normalize(phrase).split(/[^a-zа-я0-9]+/i).filter((item) => item.length >= 5)]).slice(0, 10),
  }));

  const knownTitles = new Set(base.map((item) => normalize(item.title)));
  return [...base, ...semanticTopics.filter((item) => !knownTitles.has(normalize(item.title)))].slice(0, 10);
}

function opportunityFor(
  topic: TopicDefinition,
  brandCoverage: CompetitorCoverage,
  competitorCoverage: CompetitorCoverage[],
) {
  const verified = competitorCoverage.filter((item) => item !== "unknown");
  const covered = verified.filter((item) => item === "strong" || item === "partial").length;
  if (brandCoverage === "strong" && covered < Math.max(1, Math.ceil(verified.length / 2))) {
    return "Использовать подтверждённые факты бренда как заметный смысловой акцент.";
  }
  if (brandCoverage === "missing" && covered > 0) {
    return "Закрыть ожидаемый вопрос на подтверждённых данных или вынести факт на уточнение.";
  }
  if (topic.priority === "Высокий" && covered <= 1) {
    return "Раскрыть тему глубже: у доступных страниц она почти не представлена.";
  }
  if (covered >= Math.max(1, Math.ceil(verified.length / 2))) {
    return "Дать более ясный и практичный ответ, не повторяя структуру конкурентов.";
  }
  return "Проверить уместность темы и добавить её только при наличии фактической основы.";
}

function isRecommended(topic: TopicDefinition, brandCoverage: CompetitorCoverage, coverages: CompetitorCoverage[]) {
  const verified = coverages.filter((item) => item !== "unknown");
  const covered = verified.filter((item) => item === "strong" || item === "partial").length;
  return topic.priority === "Высокий"
    || (topic.priority === "Средний" && (brandCoverage !== "missing" || covered > 0));
}

function suggestedTitle(query: string) {
  if (/санатор|курорт|лечен|реабилитац|восстановлен/i.test(query)) {
    return "Как выбрать санаторий для восстановления: критерии и вопросы до бронирования";
  }
  const normalizedQuery = query.replace(/[.!?]+$/, "");
  return `Как выбрать ${normalizedQuery}: критерии, сравнение и важные вопросы`;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as CompetitorPayload;
    const query = clean(payload.query, 220);
    const competitors = cleanCompetitors(payload.competitors);
    const semanticKeywords = cleanSemanticKeywords(payload.semanticKeywords);
    const brand = cleanBrand(payload.brand);

    if (!query) return Response.json({ error: "Укажите тему или основной запрос." }, { status: 400 });
    if (competitors.length < 2) return Response.json({ error: "Добавьте минимум две страницы конкурентов." }, { status: 400 });
    await assertSecondaryQuotaAvailable("research");

    const [brandWebsite, competitorWebsites] = await Promise.all([
      readWebsiteContext(brand.website),
      Promise.all(competitors.map((item) => readWebsiteContext(item.url))),
    ]);

    const sources: CompetitorSource[] = competitors.map((item, index) => ({
      ...item,
      url: competitorWebsites[index].resolvedUrl || item.url,
      status: sourceStatus(competitorWebsites[index]),
    }));
    const brandText = [brand.description, brand.positioning, brand.audience, brand.advantages, brandWebsite.text].filter(Boolean).join("\n");
    const brandStatus: WebsiteContext["status"] | "profile" = brandText ? "profile" : brandWebsite.status;
    const definitions = /санатор|курорт|лечен|реабилитац|восстановлен/i.test(query)
      ? sanatoriumTopics()
      : genericTopics(query, semanticKeywords);

    const topics = definitions.map((topic) => {
      const coverage = Object.fromEntries(sources.map((source, index) => [
        source.id,
        coverageFor(competitorWebsites[index].text, competitorWebsites[index].status, topic.keywords),
      ])) as Record<string, CompetitorCoverage>;
      const competitorCoverage = sources.map((source) => coverage[source.id] ?? "unknown");
      const brandCoverage = coverageFor(brandText, brandStatus, topic.keywords);
      return {
        id: topic.id,
        title: topic.title,
        cluster: topic.cluster,
        priority: topic.priority,
        rationale: topic.rationale,
        brandCoverage,
        coverage,
        opportunity: opportunityFor(topic, brandCoverage, competitorCoverage),
        recommended: isRecommended(topic, brandCoverage, competitorCoverage),
      };
    });

    const loadedSources = sources.filter((item) => item.status === "loaded");
    const commonTopics = loadedSources.length
      ? topics.filter((topic) => {
        const covered = loadedSources.filter((source) => topic.coverage[source.id] === "strong" || topic.coverage[source.id] === "partial").length;
        return covered >= Math.ceil(loadedSources.length / 2);
      }).slice(0, 5).map((topic) => topic.title)
      : [];
    const gaps = topics.filter((topic) => topic.recommended && (
      topic.brandCoverage === "missing"
      || loadedSources.filter((source) => topic.coverage[source.id] === "strong").length <= 1
    )).slice(0, 5).map((topic) => topic.title);
    const suggestedStructure = topics
      .filter((topic) => topic.recommended)
      .sort((left, right) => (left.priority === "Высокий" ? -1 : 0) - (right.priority === "Высокий" ? -1 : 0))
      .slice(0, 6)
      .map((topic) => topic.title);
    const loadedCount = loadedSources.length;
    const unavailableCount = sources.length - loadedCount;
    const dataNote = [
      `Прочитано страниц: ${loadedCount} из ${sources.length}.`,
      unavailableCount ? `${unavailableCount} ${unavailableCount === 1 ? "источник помечен" : "источника помечены"} как непроверенные и не считаются пустыми.` : "Все указанные страницы доступны для структурного сравнения.",
      `Профиль бренда: ${websiteSourceLabel(brandWebsite)}.`,
      "Матрица фиксирует наличие тем, но не оценивает качество медицинских, юридических или коммерческих утверждений.",
    ].join(" ");

    const usage = await recordResearch();
    return Response.json({
      mode: "demo",
      usage,
      result: {
        query,
        competitors: sources,
        topics,
        commonTopics,
        gaps,
        suggestedTitle: suggestedTitle(query),
        suggestedStructure,
        dataNote,
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return Response.json({ error: "Не удалось прочитать страницы и построить матрицу." }, { status: 500 });
  }
}
