import {
  FORMAT_PLANS,
  TONE_PLANS,
  UNIVERSAL_EDITORIAL_RULES,
  type ContentFormat,
  type ContentTone,
} from "../../content-plans";
import { readWebsiteContext } from "../_lib/website-context";
import { assertGenerationQuotaAvailable, recordGeneration, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";
import { AiCallError, callAiModel } from "../_lib/ai-router";
import type { AiOperation } from "../_lib/ai-config";

type Format = ContentFormat;

type GeographyTarget = {
  key: string;
  label: string;
  detail: string;
};

type BrandProfile = {
  name: string;
  website: string;
  description: string;
  positioning: string;
  audience: string;
  advantages: string;
  voice: string;
  restrictions: string;
  signature: string;
  prohibited: string;
};

type GeneratePayload = {
  brandId?: unknown;
  format?: unknown;
  topic?: unknown;
  keywords?: unknown;
  tone?: unknown;
  length?: unknown;
  accent?: unknown;
  useBrand?: unknown;
  useSemantics?: unknown;
  useCompetitors?: unknown;
  brand?: Partial<Record<keyof BrandProfile, unknown>>;
  geography?: unknown;
  semanticContext?: unknown;
  competitorContext?: unknown;
};

type GeneratedMaterial = {
  title: string;
  body: string;
  metaTitle: string;
  metaDescription: string;
  editorialComment: string;
};

const MATERIAL_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    editorial_comment: { type: "string" },
  },
  required: ["title", "body", "meta_title", "meta_description", "editorial_comment"],
  additionalProperties: false,
} as const;

type EditorialFocus = {
  label: string;
  guidance: string;
  required: boolean;
};

const FORMAT_LABELS: Record<Format, string> = {
  seo: "SEO-статья",
  social: "публикация для социальных сетей",
  ads: "рекламный текст",
  landing: "текст для страницы сайта",
};

const FORMAT_OPERATION: Record<Format, AiOperation> = {
  seo: "generate_seo_article",
  social: "generate_social_post",
  ads: "generate_ad_copy",
  landing: "generate_landing",
};

const ALLOWED_FORMATS = new Set<Format>(["seo", "social", "ads", "landing"]);
const DEFAULT_LENGTHS: Record<Format, number> = {
  seo: 1200,
  social: 150,
  ads: 100,
  landing: 500,
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanGeography(value: unknown): GeographyTarget[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).map((item, index) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      key: cleanText(source.key, 180) || `geo:${index + 1}`,
      label: cleanText(source.label, 140),
      detail: cleanText(source.detail, 180),
    };
  }).filter((item) => item.label);
}

function cleanSemanticContext(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const intentSource = source.intent && typeof source.intent === "object" ? source.intent as Record<string, unknown> : {};
  const selectedKeywords = Array.isArray(source.selectedKeywords)
    ? source.selectedKeywords.slice(0, 12).map((item) => {
      const keyword = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        phrase: cleanText(keyword.phrase, 180),
        breadth: cleanText(keyword.breadth, 40),
        role: cleanText(keyword.role, 60),
        cluster: cleanText(keyword.cluster, 100),
        intent: cleanText(keyword.intent, 80),
      };
    }).filter((item) => item.phrase)
    : [];

  const result = {
    query: cleanText(source.query, 300),
    suggestedTopic: cleanText(source.suggestedTopic, 300),
    intent: {
      label: cleanText(intentSource.label, 80),
      stage: cleanText(intentSource.stage, 80),
      summary: cleanText(intentSource.summary, 600),
    },
    selectedKeywords,
  };
  return result.query || result.suggestedTopic || result.selectedKeywords.length ? result : null;
}

function cleanCompetitorContext(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const selectedTopics = Array.isArray(source.selectedTopics)
    ? source.selectedTopics.slice(0, 6).map((item) => {
      const topic = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        title: cleanText(topic.title, 180),
        cluster: cleanText(topic.cluster, 100),
        priority: cleanText(topic.priority, 40),
        rationale: cleanText(topic.rationale, 700),
        opportunity: cleanText(topic.opportunity, 700),
      };
    }).filter((item) => item.title)
    : [];
  const cleanList = (list: unknown, maximum: number) => Array.isArray(list)
    ? list.slice(0, maximum).map((item) => cleanText(item, 240)).filter(Boolean)
    : [];
  const result = {
    query: cleanText(source.query, 300),
    selectedTopics,
    commonTopics: cleanList(source.commonTopics, 8),
    gaps: cleanList(source.gaps, 8),
    suggestedStructure: cleanList(source.suggestedStructure, 12),
  };
  return result.query || result.selectedTopics.length ? result : null;
}

function toneRules(tone: string) {
  return TONE_PLANS[tone as ContentTone] ?? TONE_PLANS["Экспертный"];
}

function normalizePayload(raw: GeneratePayload) {
  const requestedFormat = cleanText(raw.format, 20) as Format;
  const format = ALLOWED_FORMATS.has(requestedFormat) ? requestedFormat : "seo";
  const requestedLength = Number(raw.length);
  const length = Number.isFinite(requestedLength) && requestedLength >= 30 && requestedLength <= 4000
    ? Math.round(requestedLength)
    : DEFAULT_LENGTHS[format];
  const sourceBrand = raw.brand ?? {};
  const semanticContext = cleanSemanticContext(raw.semanticContext);
  const competitorContext = cleanCompetitorContext(raw.competitorContext);

  return {
    brandId: cleanText(raw.brandId, 100),
    format,
    topic: cleanText(raw.topic, 300),
    keywords: cleanText(raw.keywords, 1200),
    tone: cleanText(raw.tone, 80) || "Экспертный",
    length,
    accent: cleanText(raw.accent, 3200),
    useBrand: raw.useBrand !== false,
    useSemantics: raw.useSemantics === true && Boolean(semanticContext),
    useCompetitors: raw.useCompetitors === true && Boolean(competitorContext),
    geography: cleanGeography(raw.geography),
    semanticContext,
    competitorContext,
    brand: {
      name: cleanText(sourceBrand.name, 160),
      website: cleanText(sourceBrand.website, 220),
      description: cleanText(sourceBrand.description, 1800),
      positioning: cleanText(sourceBrand.positioning, 1400),
      audience: cleanText(sourceBrand.audience, 1200),
      advantages: cleanText(sourceBrand.advantages, 1800),
      voice: cleanText(sourceBrand.voice, 1200),
      restrictions: cleanText(sourceBrand.restrictions, 1200),
      signature: cleanText(sourceBrand.signature, 700),
      prohibited: cleanText(sourceBrand.prohibited, 1200),
    } satisfies BrandProfile,
  };
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function trimToWordTarget(value: string, target: number) {
  const parts = value.match(/\S+|\s+/g) ?? [];
  let words = 0;
  let result = "";

  for (const part of parts) {
    if (/\S/.test(part)) {
      if (words >= target) break;
      words += 1;
    }
    result += part;
  }

  const trimmed = result.trim();
  const lastStop = Math.max(trimmed.lastIndexOf("."), trimmed.lastIndexOf("!"), trimmed.lastIndexOf("?"));
  const stopped = lastStop >= trimmed.length * 0.96 ? trimmed.slice(0, lastStop + 1) : trimmed;
  return /[.!?]$/.test(stopped) ? stopped : `${stopped}.`;
}

// Deterministic overshoot backstop for a real AI-written body (see the
// mechanical-trim step in POST below). Splits on blank lines (the model
// always writes section breaks this way per the prompt's "уместными
// подзаголовками" instruction) and, when there's more than one section,
// keeps the last one — almost always the conclusion/CTA — untouched,
// trimming only the sections before it. That avoids the one thing a flat
// word-count cut risks: lopping off the ending entirely.
function trimOverflowBody(body: string, target: number) {
  const sections = body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (sections.length <= 1) return trimToWordTarget(body, target);

  const conclusion = sections.at(-1) || "";
  const conclusionWords = countWords(conclusion);
  if (conclusionWords >= target) return trimToWordTarget(body, target);

  const core = trimToWordTarget(sections.slice(0, -1).join("\n\n"), target - conclusionWords);
  return `${core}\n\n${conclusion}`;
}

const META_LEAKAGE_PATTERNS = [
  /материал адресован/i,
  /материал подготовлен в стиле/i,
  /профил[ье] бренда/i,
  /выбранн(?:ый|ая) стил[ьья]/i,
  /ключев(?:ые слова|ые темы|ая тема)/i,
  /правил[оа] формат/i,
  /текст говорит не абстрактно/i,
  /аудитори[яи] описан/i,
  /редакционн(?:ый|ая) ориентир/i,
  /дополнительный редакционный ракурс/i,
  /^что получает читатель$/im,
  /^условия и следующий шаг$/im,
];

function hasMetaLeakage(value: string) {
  return META_LEAKAGE_PATTERNS.some((pattern) => pattern.test(value));
}

const GEO_GENERIC_WORDS = new Set([
  "федеральный", "федерального", "округ", "область", "областной", "республика",
  "край", "автономный", "автономная", "город", "россия", "российская",
]);

function stemRussianWord(value: string) {
  const normalized = value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const endings = ["иями", "ями", "ами", "ского", "цкого", "ого", "ему", "ому", "ими", "ыми", "иях", "ах", "ях", "ов", "ев", "ская", "ский", "ское", "ую", "юю", "ая", "яя", "ое", "ее", "ые", "ие", "ых", "их", "ом", "ем", "ам", "ям", "ой", "ей", "ы", "и", "а", "я", "у", "ю", "е", "о"];
  const ending = endings.find((candidate) => normalized.endsWith(candidate) && normalized.length - candidate.length >= 4);
  return ending ? normalized.slice(0, -ending.length) : normalized;
}

function geographyTokens(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((item) => item.length >= 4 && !GEO_GENERIC_WORDS.has(item))
    .map(stemRussianWord);
}

function geographyMentioned(text: string, label: string) {
  const haystack = geographyTokens(text);
  const targets = geographyTokens(label);
  return targets.length > 0 && targets.every((target) => haystack.some((token) => {
    if (target === token) return true;
    const sharedLength = Math.min(target.length, token.length);
    return sharedLength >= 5 && (target.startsWith(token) || token.startsWith(target));
  }));
}

const TOPIC_GENERIC_WORDS = new Set([
  "как", "что", "где", "когда", "какой", "какая", "какие", "почему", "зачем",
  "для", "при", "про", "или", "это", "без", "под", "над", "после", "перед",
  "выбрать", "выбор", "лучший", "лучшие", "статья", "материал", "обзор",
  "санаторий", "санатория", "санаторный", "санаторное", "курорт", "курорта",
  "лечение", "лечения", "лечить", "лечебный", "лечебная", "программа", "программы",
]);

function semanticTokens(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((item) => item.length >= 4 && !TOPIC_GENERIC_WORDS.has(item))
    .map(stemRussianWord)
    .filter((item, index, all) => item.length >= 4 && all.indexOf(item) === index);
}

function tokenMentioned(text: string, target: string) {
  return semanticTokens(text).some((token) => {
    if (token === target) return true;
    const sharedLength = Math.min(token.length, target.length);
    return sharedLength >= 5 && (token.startsWith(target) || target.startsWith(token));
  });
}

function topicCoverage(material: GeneratedMaterial, input: ReturnType<typeof normalizePayload>) {
  const terms = semanticTokens(input.topic).slice(0, 5);
  if (!terms.length) return { terms, matchedTerms: [] as string[], matchingSections: 0, requiredSections: 0, passes: true };
  const sections = material.body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const matchedTerms = terms.filter((term) => tokenMentioned(material.body, term));
  const matchingSections = sections.filter((section) => terms.some((term) => tokenMentioned(section, term))).length;
  const requiredSections = input.length >= 650 ? 3 : input.length >= 160 ? 2 : 1;
  const requiredTermCount = Math.max(1, Math.ceil(terms.length * 0.6));
  return {
    terms,
    matchedTerms,
    matchingSections,
    requiredSections,
    passes: matchedTerms.length >= requiredTermCount && matchingSections >= requiredSections,
  };
}

function missingEditorialFocuses(material: GeneratedMaterial, input: ReturnType<typeof normalizePayload>) {
  const required = activeEditorialFocuses(input).filter((item) => item.required);
  return required.filter((item) => {
    const terms = semanticTokens(item.label);
    if (!terms.length) return false;
    return !terms.some((term) => tokenMentioned(material.body, term));
  });
}

function coverageSummary(material: GeneratedMaterial, input: ReturnType<typeof normalizePayload>) {
  const subject = topicCoverage(material, input);
  const focuses = activeEditorialFocuses(input).filter((item) => item.required);
  const missingFocuses = missingEditorialFocuses(material, input);
  const keywords = selectedKeywords(input);
  const missingKeyPhrases = missingKeywords(material, input);
  return {
    topic: input.topic,
    subjectApplied: subject.passes,
    subjectSections: subject.matchingSections,
    editorialFocusTotal: focuses.length,
    editorialFocusApplied: focuses.filter((item) => !missingFocuses.some((missing) => missing.label === item.label)).map((item) => item.label),
    editorialFocusMissing: missingFocuses.map((item) => item.label),
    geographyApplied: input.geography.slice(0, 5).map((item) => item.label),
    keywordTotal: keywords.length,
    keywordApplied: keywords.filter((item) => !missingKeyPhrases.includes(item)),
    keywordMissing: missingKeyPhrases,
  };
}

function missingGeography(material: GeneratedMaterial, input: ReturnType<typeof normalizePayload>) {
  const publication = `${material.title}\n${material.body}\n${material.metaTitle}\n${material.metaDescription}`;
  return input.geography.slice(0, 5).filter((item) => !geographyMentioned(publication, item.label)).map((item) => item.label);
}

function selectedKeywords(input: ReturnType<typeof normalizePayload>) {
  const maximum = input.format === "seo" ? 8 : input.format === "landing" ? 3 : 1;
  const semanticPhrases = input.useSemantics ? input.semanticContext?.selectedKeywords.map((item) => item.phrase) ?? [] : [];
  return [input.keywords, ...semanticPhrases]
    .join("\n")
    .split(/[,;\n]+/)
    .map((item) => item.trim().replace(/[.!?]+$/, ""))
    .filter((item, index, all) => item.length >= 3 && all.findIndex((candidate) => candidate.toLocaleLowerCase("ru-RU") === item.toLocaleLowerCase("ru-RU")) === index)
    .slice(0, maximum);
}

function keywordSearchTokens(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(stemRussianWord);
}

function containsKeywordPhrase(value: string, keyword: string) {
  const haystack = keywordSearchTokens(value);
  const needle = keywordSearchTokens(keyword);
  if (!needle.length || needle.length > haystack.length) return false;
  return haystack.some((_, index) => needle.every((token, offset) => haystack[index + offset] === token));
}

function missingKeywords(material: GeneratedMaterial, input: ReturnType<typeof normalizePayload>) {
  const publication = `${material.title}\n${material.body}\n${material.metaTitle}\n${material.metaDescription}`;
  return selectedKeywords(input).filter((keyword) => !containsKeywordPhrase(publication, keyword));
}

function parseEditorialFocuses(value: string): EditorialFocus[] {
  const lines = value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const focuses: EditorialFocus[] = [];

  for (const line of lines) {
    if (/^использовать выводы матрицы/i.test(line)) continue;
    const isBullet = /^[•*\-–—]\s*/.test(line);
    const cleaned = line.replace(/^[•*\-–—]\s*/, "").trim();
    const userComment = cleaned.match(/^комментарий пользователя\s*:\s*(.+)$/i);
    if (userComment) {
      focuses.push({ label: "Комментарий пользователя", guidance: userComment[1].trim(), required: false });
      continue;
    }

    const divider = cleaned.indexOf(":");
    if (isBullet && divider > 1) {
      const label = cleaned.slice(0, divider).trim().slice(0, 160);
      const guidance = cleaned.slice(divider + 1).trim().slice(0, 700);
      if (label) focuses.push({ label, guidance, required: true });
      continue;
    }

    if (!isBullet && cleaned) {
      focuses.push({ label: "Дополнительный акцент", guidance: cleaned.slice(0, 900), required: false });
    }
  }

  return focuses.slice(0, 8);
}

function activeEditorialFocuses(input: ReturnType<typeof normalizePayload>) {
  const focuses = parseEditorialFocuses(input.accent);
  if (input.useCompetitors && input.competitorContext) {
    for (const topic of input.competitorContext.selectedTopics) {
      focuses.push({
        label: topic.title,
        guidance: [topic.rationale, topic.opportunity].filter(Boolean).join(" ").slice(0, 900),
        required: true,
      });
    }
  }
  return focuses
    .filter((item, index, all) => all.findIndex((candidate) => candidate.label.toLocaleLowerCase("ru-RU") === item.label.toLocaleLowerCase("ru-RU")) === index)
    .slice(0, 10);
}

function materialFromRecord(parsed: Record<string, unknown>): GeneratedMaterial {
  const title = cleanText(parsed.title, 500);
  const body = cleanText(parsed.body, 50000);

  if (!title || !body) throw new Error("AI returned an incomplete material");

  return {
    title,
    body,
    metaTitle: cleanText(parsed.meta_title, 500) || title.slice(0, 70),
    metaDescription: cleanText(parsed.meta_description, 1000),
    editorialComment: cleanText(parsed.editorial_comment, 1600),
  };
}

export async function POST(request: Request) {
  try {
    const raw = (await request.json()) as GeneratePayload;
    const input = normalizePayload(raw);

    if (!input.topic) {
      return Response.json({ error: "Укажите тему материала." }, { status: 400 });
    }

    await assertGenerationQuotaAvailable();

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return Response.json({
        error: "ИИ пока не подключён. Демонстрационные ответы отключены, чтобы КЛИО не подменяла вашу тему шаблонным текстом.",
        code: "AI_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const identity = await workspaceIdentity();
    const website = input.useBrand ? await readWebsiteContext(input.brand.website) : await readWebsiteContext("");
    const operation = FORMAT_OPERATION[input.format];
    const formatPlan = FORMAT_PLANS[input.format];
    const selectedToneRules = toneRules(input.tone);
    const userBrief = JSON.stringify({
      format: FORMAT_LABELS[input.format],
      format_contract: {
        objective: formatPlan.result,
        plan: formatPlan.steps,
        rules: formatPlan.aiRules,
      },
      topic: input.topic,
      topic_contract: {
        primary_subject: input.topic,
        required_subject_terms: semanticTokens(input.topic).slice(0, 5),
        minimum_body_sections_with_subject: input.length >= 650 ? 3 : input.length >= 160 ? 2 : 1,
        prohibited_substitution: "не заменять предмет запроса общей статьёй о категории, другой отрасли, выборе поставщика или абстрактном бренде",
      },
      keywords: input.keywords,
      keyword_contract: {
        required_phrases: selectedKeywords(input),
        rule: "каждую фразу использовать в body хотя бы один раз в точной или грамматически корректной форме; основной ключ — также в H1 или первых 100 словах",
        prohibition: "не перечислять ключи подряд, не подписывать их как ключевые слова и не создавать ради них бессмысленные предложения",
      },
      tone: input.tone,
      tone_contract: selectedToneRules,
      target_words: input.length,
      additional_focus: input.accent,
      mandatory_editorial_focus: activeEditorialFocuses(input).map((item) => ({
        label: item.label,
        guidance: item.guidance,
        required_in_publication: item.required,
      })),
      semantic_module: input.useSemantics ? input.semanticContext : null,
      competitor_module: input.useCompetitors ? input.competitorContext : null,
      search_demand_geography: input.geography,
      geography_contract: input.geography.length ? {
        purpose: "территории целевого поискового спроса и/или точки, из которых аудитория рассматривает предложение",
        required_mentions: input.geography.slice(0, 5).map((item) => item.label),
        prohibition: "не называть эти территории местонахождением, филиалами или зоной работы бренда без подтверждения",
      } : null,
      source_facts: input.useBrand ? {
        brand_name: input.brand.name,
        website: input.brand.website,
        description: input.brand.description,
        positioning: input.brand.positioning,
        audience: input.brand.audience,
        verified_advantages: input.brand.advantages,
      } : null,
      hidden_editorial_controls: input.useBrand ? {
        voice: input.brand.voice,
        restrictions: input.brand.restrictions,
        prohibited_phrases: input.brand.prohibited,
        signature: input.brand.signature,
      } : null,
      website_snapshot: input.useBrand && website.status === "loaded"
        ? { url: website.resolvedUrl, text: website.text }
        : null,
    }, null, 2);

    let material: GeneratedMaterial;
    let usedModel = "";
    try {
      const call = await callAiModel<Record<string, unknown>>({
        operation,
        ownerEmail: identity.email,
        brandId: input.useBrand ? input.brandId : undefined,
        schemaName: "klio_generated_material",
        schema: MATERIAL_SCHEMA,
        instructions: [
          "Ты — старший русскоязычный редактор и контент‑маркетолог платформы КЛИО.",
          "Создай готовый к публикации материал по брифу и верни только валидный JSON без Markdown-ограждений.",
          ...UNIVERSAL_EDITORIAL_RULES,
          `Контракт выбранного формата «${formatPlan.title}» обязателен и важнее стилистической окраски:`,
          ...formatPlan.aiRules,
          "Тема — главный контракт материала. Сначала выдели конкретный предмет запроса, затем построй вокруг него вступление, подзаголовки, аргументацию и финал.",
          "Перед написанием классифицируй коммуникационную задачу по формулировке темы и брифу: рассказать о конкретном бренде/продукте/услуге, дать экспертный ответ, сформировать спрос, снять возражение или привести к действию. Не выбирай автоматически формат инструкции.",
          "Если тема содержит название активного бренда, компании, продукта, программы или услуги, создай маркетинговый материал именно об этом предложении: раскрой его релевантность задаче аудитории, подтверждённые сильные стороны, программу или процесс и следующий шаг. Не подменяй такую тему инструкцией по выбору категории.",
          "Если названный в теме бренд, компания или продукт реальны, но source_facts и website_snapshot не переданы (профиль бренда не заполнен или выключен), не выдумывай его функции, программу или преимущества. Сначала выполни веб‑поиск, найди официальный сайт и реальные факты об этом конкретном предложении, и уже на них построй материал. Если поиск не подтвердил, что это за компания или продукт, пиши осторожнее и опирайся только на то, что подтвердилось, отметив пробелы в editorial_comment — не подменяй недостающие факты правдоподобно звучащими выдумками.",
          "Не переносить примеры, отраслевые признаки, терминологию, структуру и факты из других запросов. Тема про финансы, технологии, образование, недвижимость или любую иную сферу должна оставаться в своей сфере во всех разделах.",
          "Недопустимо упомянуть конкретный предмет только в заголовке, Title или первом абзаце, а основной текст заменить общей статьёй о категории. Для длинного материала предмет должен содержательно раскрываться минимум в трёх разделах.",
          "Каждый элемент mandatory_editorial_focus с required_in_publication=true обязателен: раскрой его как самостоятельный смысловой тезис или содержательный раздел. Не пересказывай редакционную команду и не копируй структуру конкурентов.",
          "Если semantic_module передан, используй его для уточнения интента, ширины запросов, тематических кластеров и полноты ответа. Не превращай классификацию семантики в видимый читателю служебный текст.",
          "Если competitor_module передан, используй выбранные выводы как обязательные темы и точки дифференциации. Не копируй формулировки, порядок разделов или позиционирование конкурентов и не считай их сведения фактами активного бренда.",
          "Если для обязательного ориентира не хватает подтверждённых фактов в брифе, профиле бренда или снимке сайта, сначала выполни веб‑поиск по официальным и авторитетным источникам. Если поиск дал надёжный факт — используй его и отметь источник в editorial_comment. Если нет — раскрой безопасную практическую часть (критерии проверки, вопросы, ограничения) и укажи дефицит фактов в editorial_comment. Не игнорируй ориентир молча.",
          `Правила выбранной интонации «${input.tone}»:`,
          ...selectedToneRules,
          "Не используй выражения из prohibited. Фирменную подпись добавляй только когда она уместна для выбранного формата и прямо передана в профиле.",
          "Выбранная география описывает территорию поискового спроса и должна заметно влиять на готовый материал. Если список не пуст, естественно упомяни каждую территорию из geography_contract.required_mentions хотя бы один раз — как контекст аудитории, маршрута, спроса или выбора.",
          "География спроса не доказывает, что бренд находится, работает или имеет филиал в этих местах. Не превращай её в факт о компании и не добавляй неподтверждённую локализацию.",
          "Поля source_facts и hidden_editorial_controls — внутренний бриф, а не содержание публикации. Никогда не пересказывай устройство брифа, профиль бренда, описание аудитории, выбранный стиль, ключевые слова или правила формата.",
          "Не используй мета-фразы «материал адресован», «текст говорит», «профиль бренда», «выбранный стиль», «ключевые темы» и подобные редакционные пояснения.",
          "Факты и преимущества вплетай в тему естественно. Позиционирование можно переформулировать; не копируй его отдельным рекламным абзацем.",
          "Выполни keyword_contract: каждая required_phrases должна присутствовать в body хотя бы один раз в точной или грамматически корректной форме. Не выдавай ключи списком и не комментируй SEO‑настройки. Ориентируйся на целевой объём, отклонение до 15% допустимо.",
          "Не добивай текст вариациями одного ключа. Поисковые формулировки нужны для ясного соответствия интенту, а не для плотности: при конфликте с естественностью используй грамматически корректную форму и сохрани смысл.",
          "Материал должен добавлять собственную пользу: предметное объяснение, подтверждённые факты бренда, практический вывод или решение задачи. Не пересказывай абстрактно то, что могло бы относиться к любой компании.",
          "Для медицинской тематики избегай гарантий результата, диагнозов и персональных назначений.",
          "Структура JSON: title, body, meta_title, meta_description, editorial_comment. Все значения — строки.",
          "body должен быть цельным русским текстом с абзацами и уместными подзаголовками без служебных комментариев.",
          "editorial_comment кратко объясняет использованный ракурс, соблюдение голоса бренда и возможные места для фактчекинга; он не является частью статьи.",
        ].join("\n"),
        input: `Подготовь материал по этому брифу:\n${userBrief}`,
      });
      material = materialFromRecord(call.result);
      usedModel = call.model;
    } catch (error) {
      if (error instanceof AiCallError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    // ±15%, not ±5% — LLMs reliably land "close" to a target length, not
    // exact, and hard-rejecting near-misses was discarding good articles
    // and forcing costly full retries. Coverage badges in the UI already
    // surface a length mismatch softly without blocking the result.
    const minimumWords = Math.floor(input.length * 0.85);
    const maximumWords = Math.ceil(input.length * 1.15);
    let missingGeo = missingGeography(material, input);
    let subjectCheck = topicCoverage(material, input);
    let missingFocuses = missingEditorialFocuses(material, input);
    let missingKeyPhrases = missingKeywords(material, input);

    if (countWords(material.body) < minimumWords || countWords(material.body) > maximumWords || hasMetaLeakage(material.body) || missingGeo.length || !subjectCheck.passes || missingFocuses.length || missingKeyPhrases.length) {
      try {
        const correctionCall = await callAiModel<Record<string, unknown>>({
          operation: "revise_content",
          ownerEmail: identity.email,
          brandId: input.useBrand ? input.brandId : undefined,
          schemaName: "klio_corrected_material",
          schema: MATERIAL_SCHEMA,
          instructions: [
            "Ты — выпускающий редактор платформы КЛИО.",
            "Приведи материал к заданному объёму, сохранив тему, факты, ключевые фразы, структуру и голос бренда.",
            `Требуемый объём: ${input.length} слов. Допустимый диапазон: ${minimumWords}–${maximumWords} слов.`,
            "Не добавляй неподтверждённые факты и не повторяй абзацы ради объёма.",
            `Сохрани контракт формата «${formatPlan.title}»:`,
            ...formatPlan.aiRules,
            `Сохрани правила интонации «${input.tone}»:`,
            ...selectedToneRules,
            "Удали весь метатекст о брифе, профиле бренда, аудитории, стиле, ключевых словах и правилах формата. Читатель должен видеть только готовую публикацию по теме.",
            !subjectCheck.passes
              ? `Основной текст подменил или недостаточно раскрыл предмет «${input.topic}». Перестрой композицию так, чтобы конкретный предмет запроса содержательно присутствовал минимум в ${subjectCheck.requiredSections} разделах, а не только в заголовке.`
              : `Сохрани предмет «${input.topic}» как основу всей композиции.`,
            missingFocuses.length
              ? `Не применены обязательные редакционные ориентиры: ${missingFocuses.map((item) => item.label).join(", ")}. Раскрой каждый как содержательный тезис или раздел без копирования конкурентов и без служебных формулировок.`
              : "Сохрани все уже применённые редакционные ориентиры матрицы.",
            missingKeyPhrases.length
              ? `Не использованы выбранные ключевые фразы: ${missingKeyPhrases.join(", ")}. Естественно встрои каждую в body в точной или грамматически корректной форме; не перечисляй их подряд и не называй ключами.`
              : "Сохрани все уже применённые ключевые фразы без переспама.",
            missingGeo.length
              ? `Материал не применил выбранную географию: ${missingGeo.join(", ")}. Естественно упомяни эти территории как контекст аудитории, маршрута, спроса или выбора, не называя их местонахождением бренда без подтверждения.`
              : "Сохрани уже применённую географию спроса и не подменяй её местонахождением бренда.",
            "Верни только валидный JSON с полями title, body, meta_title, meta_description, editorial_comment.",
          ].join("\n"),
          input: JSON.stringify({ brief: JSON.parse(userBrief), current_material: material }),
        });
        material = materialFromRecord(correctionCall.result);
        usedModel = correctionCall.model;
        missingGeo = missingGeography(material, input);
        subjectCheck = topicCoverage(material, input);
        missingFocuses = missingEditorialFocuses(material, input);
        missingKeyPhrases = missingKeywords(material, input);
      } catch (error) {
        // The correction pass is best-effort — if it fails, fall through
        // with the original material rather than losing the whole result.
        console.error("Generation correction pass failed", error);
      }
    }

    // Backstop for a case the correction pass sometimes still misses: a
    // genuine overshoot (e.g. 130% of target). Rather than ship a too-long
    // article and then tell the client in the UI that "the result doesn't
    // match the brief" — which reads as KLIO admitting a failed generation
    // — shrink it here before the client ever sees it. First choice is a
    // cheap nano pass that actually reads the text and condenses it
    // without breaking an argument that continues into the next sentence
    // (a blind word-count cut can't tell the difference between "the end
    // of a thought" and "a sentence boundary"). A purely mechanical trim
    // is only the fallback if that call itself fails — always leave the
    // client with *something* rather than an error.
    if (countWords(material.body) > maximumWords) {
      try {
        const condenseCall = await callAiModel<Record<string, unknown>>({
          operation: "condense_overflow",
          ownerEmail: identity.email,
          brandId: input.useBrand ? input.brandId : undefined,
          schemaName: "klio_condensed_material",
          schema: MATERIAL_SCHEMA,
          instructions: [
            "Ты сокращаешь уже готовую статью до целевого объёма, не переписывая её заново.",
            `Целевой объём: ${input.length} слов, допустимо от ${minimumWords} до ${maximumWords}.`,
            "Сокращай за счёт наименее важного: повторов, избыточных примеров, лишних деталей. Не обрывай мысль или аргумент на середине — если предложение продолжает мысль из предыдущего, сокращай их вместе или не трогай.",
            "Не добавляй новые факты, не меняй заголовок, тему, ключевые фразы и структуру подзаголовков без необходимости.",
            "Сохрани meta_title, meta_description и editorial_comment по смыслу как есть (можно чуть скорректировать под новый объём).",
            "Верни только валидный JSON с полями title, body, meta_title, meta_description, editorial_comment.",
          ].join("\n"),
          input: JSON.stringify({ target_words: input.length, current_material: material }),
        });
        material = materialFromRecord(condenseCall.result);
        usedModel = condenseCall.model;
      } catch (error) {
        console.error("Nano condense pass failed, falling back to mechanical trim", error);
        material = { ...material, body: trimOverflowBody(material.body, input.length) };
      }
      missingGeo = missingGeography(material, input);
      subjectCheck = topicCoverage(material, input);
      missingFocuses = missingEditorialFocuses(material, input);
      missingKeyPhrases = missingKeywords(material, input);
    }

    // Word count, geography, editorial-focus and keyword coverage are all
    // soft targets: the correction pass above already tried once to fix
    // them, and the client already renders a per-criterion coverage badge
    // (see coverageSummary below) instead of a pass/fail wall. Hard-
    // rejecting near-misses here used to discard a perfectly usable
    // article and force a full, costly retry — sometimes repeatedly.
    // Meta-leakage (internal brief text visible in the article) and a
    // hijacked topic are real defects, not just imprecision, so those two
    // still block.
    if (hasMetaLeakage(material.body)) {
      return Response.json(
        { error: "AI‑редакция обнаружила в тексте служебные формулировки. Материал не принят — запустите генерацию ещё раз." },
        { status: 422 },
      );
    }

    if (!subjectCheck.passes) {
      return Response.json(
        { error: `AI‑редакция не раскрыла предмет темы «${input.topic}» в основном тексте. Материал не принят — запустите генерацию ещё раз.` },
        { status: 422 },
      );
    }

    const usage = await recordGeneration({
      brandId: input.brandId,
      format: input.format,
      topic: input.topic,
      title: material.title,
      body: material.body,
      metaTitle: material.metaTitle,
      metaDescription: material.metaDescription,
      editorialComment: material.editorialComment,
      keywords: input.keywords,
      tone: input.tone,
      targetLength: input.length,
    });
    return Response.json({ material, mode: "ai", model: usedModel, coverage: coverageSummary(material, input), sources: { website: website.status, geography: input.geography.map((item) => item.label) }, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Generation route failed", error);
    return Response.json(
      { error: "Не удалось сформировать материал. Проверьте поля и повторите попытку." },
      { status: 500 },
    );
  }
}
