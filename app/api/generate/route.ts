import {
  FORMAT_PLANS,
  TONE_PLANS,
  UNIVERSAL_EDITORIAL_RULES,
  type ContentFormat,
  type ContentTone,
} from "../../content-plans";
import { readWebsiteContext, websiteSourceLabel, type WebsiteContext } from "../_lib/website-context";
import { assertGenerationQuotaAvailable, recordGeneration, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";

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
  seoRules: string;
  socialRules: string;
  adsRules: string;
  landingRules: string;
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

const ALLOWED_FORMATS = new Set<Format>(["seo", "social", "ads", "landing"]);
const DEFAULT_LENGTHS: Record<Format, number> = {
  seo: 1200,
  social: 150,
  ads: 100,
  landing: 500,
};

function activeFormatRule(brand: BrandProfile, format: Format) {
  if (format === "social") return brand.socialRules;
  if (format === "ads") return brand.adsRules;
  if (format === "landing") return brand.landingRules;
  return brand.seoRules;
}

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
      seoRules: cleanText(sourceBrand.seoRules, 1400),
      socialRules: cleanText(sourceBrand.socialRules, 1400),
      adsRules: cleanText(sourceBrand.adsRules, 1400),
      landingRules: cleanText(sourceBrand.landingRules, 1400),
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

function fitDemoLength(sections: string[], target: number) {
  const complete = sections.join("\n\n");
  if (countWords(complete) <= target) return complete;

  if (target > 350 && sections.length > 2) {
    const conclusion = sections.at(-1) || "";
    const conclusionWords = countWords(conclusion);
    const coreTarget = Math.max(1, target - conclusionWords);
    const core = trimToWordTarget(sections.slice(0, -1).join("\n\n"), coreTarget);
    return `${core}\n\n${conclusion}`;
  }

  return trimToWordTarget(complete, target);
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

function demoGeographySection(input: ReturnType<typeof normalizePayload>) {
  if (input.format !== "seo" && input.format !== "landing") return "";
  const labels = input.geography.slice(0, 5).map((item) => item.label);
  if (!labels.length) return "";
  return `Учтите географию поездки\n\nЕсли вы планируете поездку, находясь в одной из выбранных территорий — ${naturalList(labels)} — заранее сравните варианты дороги, трансфера и времени прибытия. География влияет на удобство маршрута и сезон поездки, но сама по себе не подтверждает, что у конкретного бренда есть филиал или представительство в этих регионах.`;
}

function cleanTopic(value: string) {
  const cleaned = value.trim().replace(/[.!?]+$/, "");
  return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : "Как выбрать решение под свою задачу";
}

function listItems(value: string) {
  return value.split(/[;\n]/).map((item) => item.trim().replace(/[.;]+$/, "")).filter(Boolean);
}

function naturalList(items: string[]) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} и ${items.at(-1)}`;
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

function isSanatoriumContext(input: ReturnType<typeof normalizePayload>) {
  const source = `${input.topic} ${input.keywords} ${input.useBrand ? `${input.brand.name} ${input.brand.description}` : ""}`;
  return /санатор|курорт|лечен|реабилитац|оздоров|восстановлен/i.test(source);
}

function brandNameTokens(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .map(stemRussianWord)
    .filter((item) => item.length >= 4 && !["санатор", "компан", "бренд"].includes(item));
}

function isBrandMarketingTopic(input: ReturnType<typeof normalizePayload>) {
  if (!input.useBrand || !input.brand.name.trim()) return false;
  const topicTokens = keywordSearchTokens(input.topic);
  const nameTokens = brandNameTokens(input.brand.name);
  const named = nameTokens.length > 0 && nameTokens.every((token) => topicTokens.includes(token));
  const explicitGoal = /(?:цель материала|задача материала)\s*:\s*(?:продвиг|прода|маркетинг|презентац)/i.test(input.accent);
  return named || explicitGoal;
}

function keywordCoverageSections(
  input: ReturnType<typeof normalizePayload>,
  brandName: string,
  profile: ReturnType<typeof sanatoriumTopicProfile>,
  existingSections: string[],
) {
  const existing = existingSections.join("\n");
  const subjectName = input.useBrand ? brandName : "Профильный санаторий";
  return selectedKeywords(input)
    .filter((keyword) => !containsKeywordPhrase(existing, keyword))
    .map((keyword, index) => {
      const heading = cleanTopic(keyword);
      if (index === 0) {
        return `${heading}\n\n${subjectName} раскрывает это направление через ${profile.specialist}, индивидуальное определение допустимой нагрузки и подтверждённые возможности лечебной базы. Конкретные назначения формируются после медицинской оценки.`;
      }
      if (index === 1) {
        return `${heading}\n\nВ центре программы находятся ${profile.program}. Для гостя важен не общий перечень процедур, а их место в последовательном курсе и возможность корректировать назначения по самочувствию.`;
      }
      if (index === 2) {
        return `${heading}\n\nПодтверждённые факты курорта связываются с задачей гостя без универсальных обещаний. Возможность применения каждого лечебного фактора и процедуры определяет врач с учётом показаний и ограничений.`;
      }
      return `${heading}\n\nДо поездки стоит подтвердить профиль программы, документы, продолжительность и состав путёвки. Это помогает согласовать ожидания с реальными возможностями курса.`;
    });
}

function brandMarketingSanatoriumSections(input: ReturnType<typeof normalizePayload>, brandName: string) {
  const topic = cleanTopic(input.topic);
  const profile = sanatoriumTopicProfile(input);
  const spineTopic = /остеохонд|позвоноч|сустав|опорно|двигател|спин|артр|артроз/i.test(`${input.topic} ${input.keywords}`);
  const facts = listItems(input.brand.advantages);
  const programFacts = facts.filter((item) => /программ|позвоноч|вытяж|массаж|гряз|озоно|бассейн|тренаж|мрт|корсет/i.test(item)).slice(0, 7);
  const brandFacts = facts.filter((item) => !programFacts.includes(item)).slice(0, 5);
  const focuses = parseEditorialFocuses(input.accent).filter((item) => item.required).map((item) => focusSection(item, input));
  const base = [
    `${topic}\n\n${brandName} — санаторий, где работа по профилю ${profile.area} строится вокруг медицинской оценки, последовательной программы и природных лечебных факторов Карелии. Здесь исходная тема раскрывается как конкретное предложение курорта, а не как общая инструкция по выбору здравницы.`,
    `${spineTopic ? "Лечение спины" : "Профильное лечение"} в ${brandName}\n\nНаправление относится к профилю ${profile.area}. Важна не одна отдельная процедура, а сочетание ${profile.program}. Врач оценивает актуальное состояние, показания и ограничения, после чего определяет допустимую нагрузку и наполнение курса.`,
    programFacts.length
      ? `${spineTopic ? "Программа для позвоночника" : "Профильная программа"}\n\nВ профиле бренда подтверждены: ${naturalList(programFacts)}. Эти элементы образуют содержательную основу направления, но не являются одинаковым назначением для каждого гостя — итоговый набор и интенсивность процедур корректируются медицинским специалистом.`
      : `Программа, собранная вокруг задачи\n\n${brandName} связывает ${profile.program}. Точный состав курса и применимость процедур подтверждаются после консультации; неподтверждённые сроки и назначения в материале не добавляются.`,
    `Сильная медицинская база\n\nДля профильного лечения в санатории важны специалисты, возможность корректировать нагрузку и понятный маршрут гостя. В ${brandName} программа рассматривается как связный курс: консультация, назначенные процедуры, движение, отдых и наблюдение за самочувствием.`,
    brandFacts.length
      ? `Природные преимущества первого российского курорта\n\nСреди подтверждённых особенностей ${brandName} — ${naturalList(brandFacts)}. Природные факторы усиливают предложение курорта, но применяются только с учётом медицинских показаний и ограничений.`
      : `Природные лечебные факторы Карелии\n\n${profile.factor}. Их задача — быть частью медицински обоснованной программы, а не самостоятельным обещанием результата.`,
    ...focuses,
    spineTopic && programFacts.some((item) => /мрт|корсет/i.test(item))
      ? `Подготовка к программе\n\nДо заезда необходимо уточнить перечень документов и исследований, которые нужны именно для выбранного направления. Для программы позвоночника в профиле бренда указаны требования к актуальности МРТ и наличию полужёсткого корсета; окончательные требования и возможность участия следует подтвердить у санатория до бронирования.`
      : `Подготовка к программе\n\nДо заезда уточните перечень документов и исследований для выбранного направления. Актуальные медицинские сведения помогают врачу оценить показания, ограничения и допустимый состав курса; точные требования следует подтвердить у санатория до бронирования.`,
    `Курс, в котором лечение сочетается с восстановлением\n\nСанаторный формат позволяет распределить процедуры и физическую нагрузку по дням, оставить время на отдых и прогулки. Такой ритм помогает воспринимать программу как единый маршрут восстановления, а не как набор разрозненных кабинетов.`,
    `Следующий шаг\n\nЧтобы подобрать программу в ${brandName}, подготовьте актуальные медицинские документы и свяжитесь с санаторием для предварительного уточнения профиля, продолжительности и условий путёвки. Назначения определяются врачом после оценки состояния.`,
  ];
  const keywordSections = keywordCoverageSections(input, brandName, profile, base);
  return [base[0], ...keywordSections, ...base.slice(1)].filter((section, index, all) => {
    const heading = section.split("\n")[0].trim().toLocaleLowerCase("ru-RU");
    return all.findIndex((candidate) => candidate.split("\n")[0].trim().toLocaleLowerCase("ru-RU") === heading) === index;
  });
}

function genericSections(topic: string, primaryKey: string) {
  return [
    `${topic} — задача, в которой полезно сначала определить ожидаемый результат, ограничения и критерии выбора. Чем точнее сформулирован запрос, тем проще отделить действительно подходящие варианты от привлекательных, но малоинформативных обещаний.`,
    `С чего начать\n\nОпишите исходную ситуацию и зафиксируйте, что должно измениться после решения. Затем выделите обязательные условия и параметры, которыми вы готовы поступиться. Такой список помогает сравнивать предложения по существу, а не по общему впечатлению.`,
    `Какие сведения проверить\n\nИщите конкретное описание процесса, состава услуги, ответственности сторон и возможных ограничений. Утверждения должны опираться на проверяемые факты. Если важная деталь не указана, запросите разъяснение до принятия решения.`,
    `Как сравнивать варианты\n\nИспользуйте одинаковый набор критериев для всех предложений: содержание, сроки, полная стоимость, квалификация исполнителей, поддержка и условия изменения договорённостей. Так сравнение останется честным и наглядным.`,
    `Ключевой запрос «${primaryKey}» должен получать прямой ответ, а не набор общих рекламных формулировок. Полезный материал объясняет различия, предупреждает об ограничениях и даёт читателю понятный следующий шаг.`,
    `Вопросы перед решением\n\nУточните, что входит в предложение, какие исходные данные потребуются, кто отвечает за результат и как действовать при изменении условий. Ответы покажут не только содержание услуги, но и качество будущей коммуникации.`,
    "Не торопитесь с решением под влиянием искусственной срочности. Сначала проверьте ключевые сведения, сопоставьте варианты и сохраните условия, которые имеют значение. Обоснованный выбор начинается с ясности, а не с давления.",
  ];
}

function genericSocialSections(topic: string) {
  return [
    `${topic}: начните не с готового решения, а с результата, который действительно нужен. Так проще отделить полезные варианты от общих обещаний.`,
    "Зафиксируйте обязательные условия, проверьте содержание предложения и задайте вопросы о деталях, которых нет в описании.",
    "Сравнивайте варианты по одинаковым критериям: состав, сроки, полная стоимость, поддержка и ограничения. Один понятный список часто экономит больше времени, чем десятки вкладок.",
    "Сохраните этот принцип для следующего выбора: сначала задача и факты, затем впечатление.",
  ];
}

function genericAdSections(topic: string) {
  return [
    `${topic} без лишней неопределённости.`,
    "Сравните содержание, условия и подтверждённые факты по одному понятному списку.",
    "Уточните детали и выберите решение, которое соответствует вашей задаче.",
  ];
}

function genericLandingSections(topic: string) {
  return [
    `${topic}: решение по понятным критериям\n\nСформулируйте ожидаемый результат и обязательные условия — это станет основой выбора.`,
    "Содержание предложения\n\nПроверьте процесс, состав услуги, сроки, ответственность сторон и возможные ограничения. Значимые утверждения должны опираться на конкретные факты.",
    "Честное сравнение\n\nИспользуйте одинаковые критерии для всех вариантов: содержание, полная стоимость, поддержка и условия изменения договорённостей.",
    "Следующий шаг\n\nСоберите недостающие ответы до решения. Так выбор будет основан на ясных условиях, а не на искусственной срочности.",
  ];
}

function sanatoriumTopicProfile(input: ReturnType<typeof normalizePayload>) {
  const source = `${input.topic} ${input.keywords}`.toLocaleLowerCase("ru-RU");
  if (/желуд|гастр|кишеч|пищевар|жкт|печен|желч/.test(source)) {
    return {
      area: "заболеваний желудка и органов пищеварения",
      specialist: "гастроэнтерологический профиль и участие врача в подборе курса",
      program: "питание, питьевой режим, допустимые процедуры и медицинское наблюдение",
      factor: "минеральная вода и другие природные факторы применяются только по индивидуально определённой схеме",
      question: "какие диагнозы и состояния входят в профиль, как организовано питание и кто определяет режим приёма минеральной воды",
    };
  }
  if (/остеохонд|позвоноч|сустав|опорно|двигател|спин|артр|артроз/.test(source)) {
    return {
      area: "заболеваний опорно‑двигательного аппарата",
      specialist: "профиль по опорно‑двигательному аппарату и участие врача в определении нагрузки",
      program: "лечебная физкультура, допустимые процедуры, восстановительный режим и контроль самочувствия",
      factor: "грязелечение, водные и аппаратные процедуры оцениваются как части индивидуальной программы",
      question: "какие состояния входят в профиль, нужны ли актуальные исследования и как корректируется физическая нагрузка",
    };
  }
  if (/сердц|кардио|сосуд|давлен|гипертон/.test(source)) {
    return {
      area: "сердечно‑сосудистого профиля",
      specialist: "кардиологический профиль, медицинское наблюдение и допустимый уровень нагрузки",
      program: "щадящий режим, назначенные процедуры, движение и контроль состояния",
      factor: "любые лечебные факторы рассматриваются с учётом текущего состояния и терапии",
      question: "какие документы нужны, кто оценивает допустимую нагрузку и как организовано наблюдение в ходе курса",
    };
  }
  if (/дых|бронх|легк|лор|иммун/.test(source)) {
    return {
      area: "органов дыхания и восстановительных программ",
      specialist: "профиль по органам дыхания и первичная оценка состояния",
      program: "дыхательные практики, климатические факторы, допустимые процедуры и спокойный режим",
      factor: "природные и аппаратные факторы назначаются после оценки показаний и ограничений",
      question: "какие состояния входят в профиль, когда можно планировать поездку и как формируется программа",
    };
  }
  if (/стресс|сон|тревож|нерв|переутом|выгоран/.test(source)) {
    return {
      area: "восстановления сна, нервной системы и ресурса",
      specialist: "профиль восстановительных программ и участие медицинского специалиста",
      program: "режим сна, умеренная активность, процедуры и снижение повседневной нагрузки",
      factor: "природная среда поддерживает программу, но не заменяет медицинскую оценку состояния",
      question: "как устроен распорядок, кто определяет процедуры и какие ограничения учитываются до заезда",
    };
  }
  return {
    area: `направления «${input.topic.trim()}»`,
    specialist: "профиль санатория и участие врача в подборе программы",
    program: "цель курса, допустимые процедуры, режим и медицинское сопровождение",
    factor: "природные лечебные факторы рассматриваются только в контексте показаний и ограничений",
    question: "входит ли конкретная задача в профиль, какие документы нужны и как формируется программа",
  };
}

function focusSection(focus: EditorialFocus, input: ReturnType<typeof normalizePayload>) {
  const label = focus.label.replace(/[.!?]+$/, "");
  const source = `${focus.label} ${focus.guidance}`.toLocaleLowerCase("ru-RU");
  const topic = input.topic.trim();
  let paragraph = `При рассмотрении темы «${topic}» этот аспект нужно проверять по конкретным условиям санатория. Уточните, что подтверждено в описании программы, кто отвечает за этот этап и какие ограничения действуют. Общего обещания недостаточно: читателю нужны понятные факты и порядок действий.`;

  if (/медицин|врач|специалист|профил/.test(source)) {
    paragraph = `При запросе «${topic}» важны не должности в общем списке, а роль специалистов в маршруте гостя. Уточните, кто проводит первичную консультацию, на каких данных строятся назначения и как можно сообщить об изменении самочувствия. Профиль должен соответствовать конкретной задаче поездки.`;
  } else if (/питан|диет|меню/.test(source)) {
    paragraph = `Для темы «${topic}» питание нельзя оставлять бытовой деталью. До бронирования стоит уточнить формат меню, возможность учесть назначенную врачом диету, аллергии и индивидуальные ограничения. Санаторий должен подтвердить реальные возможности, а не ограничиваться словом «диетическое».`;
  } else if (/минерал|вод|гряз|природ/.test(source)) {
    paragraph = `Природный фактор не является универсальной процедурой для запроса «${topic}». Важно объяснить, как врач определяет возможность применения, режим и сочетание с другими назначениями. Происхождение воды или грязи само по себе не подтверждает показание и не гарантирует результат.`;
  } else if (/программ|процедур|назначен/.test(source)) {
    paragraph = `Состав программы по теме «${topic}» нужно оценивать как последовательность назначений, а не как длинный каталог процедур. Спросите, что входит в путёвку, кто формирует курс, можно ли заменить неподходящую процедуру и как распределяется нагрузка по дням.`;
  } else if (/документ|подготов|обследован/.test(source)) {
    paragraph = `Подготовка к поездке по теме «${topic}» начинается с актуальных медицинских данных. Заранее уточните требования к санаторно‑курортной карте, выпискам и исследованиям, а также сроки их действия. Точный перечень должен подтвердить выбранный санаторий.`;
  } else if (/стоим|цен|бронир|путев/.test(source)) {
    paragraph = `Сравнивать предложения по теме «${topic}» корректно только при одинаковом составе. Проверьте, входят ли в стоимость проживание, питание, консультации, диагностика и процедуры, какие услуги оплачиваются отдельно и каковы условия переноса или отмены.`;
  } else if (/противопоказ|безопас|огранич/.test(source)) {
    paragraph = `Для запроса «${topic}» ограничения так же важны, как перечень возможностей. Решение о поездке и допустимой программе принимается с врачом на основании актуального состояния. Текст санатория должен обозначать границы и не обещать одинаковый результат всем.`;
  }

  return `${label}\n\n${paragraph}`;
}

function topicAwareSanatoriumSections(input: ReturnType<typeof normalizePayload>, brandName: string) {
  const topic = input.topic.trim();
  const topicLower = topic.charAt(0).toLocaleLowerCase("ru-RU") + topic.slice(1);
  const profile = sanatoriumTopicProfile(input);
  const facts = listItems(input.useBrand ? input.brand.advantages : "");
  const brandSection = input.useBrand
    ? `Что подтверждено у ${brandName}\n\nВ профиле курорта указаны ${naturalList(facts.slice(0, 4)) || "медицинское сопровождение и природные лечебные факторы"}. Для запроса «${topicLower}» эти сведения важны только после подтверждения профильной программы и консультации врача. Наличие отдельного фактора или процедуры не означает, что они автоматически подходят конкретному человеку.`
    : `Что подтвердить у выбранного санатория\n\nПо запросу «${topicLower}» запросите описание профильной программы, порядок консультации и перечень необходимых документов. Не переносите общие сведения о санатории на конкретное заболевание без подтверждения специалистов.`;
  const selectedFocusSections = parseEditorialFocuses(input.accent)
    .filter((item) => item.required)
    .map((item) => focusSection(item, input));

  const sections = [
    `${topic} — это запрос о профильном санаторно‑курортном сопровождении, а не об отдыхе или выборе здравницы вообще. В центре решения должны быть ${profile.specialist}, актуальное состояние человека и ограничения. Конкретный курс определяют после медицинской оценки; статья может помочь подготовить вопросы, но не заменяет консультацию врача.`,
    `Что именно означает этот запрос\n\nФраза «${topicLower}» может объединять разные диагнозы, задачи и этапы восстановления. Поэтому сначала уточняют, что именно беспокоит человека, есть ли установленный диагноз, как менялось состояние и какие рекомендации уже даны. Без этой информации невозможно корректно оценить профиль санатория и допустимую программу.`,
    `Проверьте профиль по конкретному направлению\n\nИщите не общий раздел «лечение», а сведения о профиле ${profile.area}. Важно понять, какие специалисты участвуют в первичной консультации, какие документы они используют и кто принимает решение о назначениях. Если сайт перечисляет только процедуры, но не объясняет маршрут пациента, задайте эти вопросы до оплаты.`,
    `Как формируется программа\n\nДля темы «${topicLower}» программа должна связывать ${profile.program}. Уточните, существует ли единый набор для всех или назначения корректируются после осмотра. Полезно заранее узнать, что произойдёт, если отдельная процедура окажется неподходящей, и можно ли пересмотреть нагрузку во время курса.`,
    ...selectedFocusSections,
    brandSection,
    `Природные лечебные факторы без универсальных обещаний\n\n${profile.factor}. До поездки спросите, какое место конкретный фактор занимает в программе, кто определяет режим и какие медицинские сведения нужны для решения. Для темы «${topicLower}» происхождение природного ресурса не заменяет индивидуальную оценку.` ,
    `Питание и режим дня\n\nДаже когда питание не является главным лечебным фактором, оно влияет на переносимость курса и повседневный комфорт. Уточните формат меню, возможность учесть назначенную диету, аллергии и ограничения, а также интервалы между едой, процедурами и отдыхом. Не предполагайте, что общая пометка «диетическое питание» автоматически решает вашу задачу.`,
    `Документы и обследования до поездки\n\nСпросите, нужна ли санаторно‑курортная карта, какие выписки и результаты исследований следует взять и каков допустимый срок их давности. Для запроса «${topicLower}» особенно важно передать врачу актуальную информацию, а не восстанавливать историю состояния по памяти уже после заезда.`,
    `Показания и ограничения\n\nПеречень услуг не отвечает на вопрос, подходит ли поездка конкретному человеку. До бронирования обсудите актуальное состояние с врачом и уточните противопоказания выбранной программы. Если состояние изменилось после оформления путёвки, нужно повторно проверить возможность поездки и состав курса, а не ориентироваться на прежние рекомендации.`,
    `Сколько времени закладывать на курс\n\nПродолжительность должна соответствовать цели, логике назначений и возможности наблюдать реакцию на нагрузку. Короткий заезд и полноценная санаторная программа решают разные задачи. Попросите санаторий объяснить рекомендуемый срок именно для выбранного направления, не приписывая нескольким дням эффект длительного курса.`,
    `Что входит в путёвку\n\nСравните проживание, питание, первичную и повторные консультации, диагностику, процедуры и дополнительные услуги. Для темы «${topicLower}» особенно важно увидеть не количество позиций, а связность программы. Отдельно проверьте возможные доплаты, правила замены назначений, переноса дат и отмены.` ,
    `Как оценить медицинское сопровождение\n\nУточните, к кому обращаться при изменении самочувствия, доступна ли повторная консультация и как фиксируются корректировки. Хорошо организованное сопровождение объясняет пациенту логику назначений и границы программы. Оно не строится на дистанционных гарантиях и не подменяет лечащего врача.` ,
    `Бытовые условия тоже влияют на курс\n\nРасположение корпуса и лечебной базы, расстояния между кабинетами, доступность лифта, тишина и удобство номера могут быть существенными. Если человеку сложно долго ходить или требуется сопровождающий, обсудите это заранее. Программа должна быть выполнимой не только на бумаге, но и в реальном распорядке дня.` ,
    `Дорога и день заезда\n\nПроверьте маршрут, трансфер, время заселения и первой консультации. Длительная дорога и позднее прибытие могут изменить первый день программы. Уточните, как санаторий действует в такой ситуации и переносятся ли пропущенные этапы, не предполагая автоматически, что расписание будет перестроено.` ,
    `Как читать отзывы\n\nИщите повторяющиеся детали по конкретному профилю: организация консультаций, понятность назначений, питание, расписание и решение вопросов. Эмоциональная оценка без контекста мало помогает запросу «${topicLower}». Полезнее сопоставлять наблюдения нескольких гостей и проверять спорные сведения у санатория.` ,
    `Вопросы до бронирования\n\nСоберите короткий список: ${profile.question}; что входит в стоимость; можно ли изменить назначения; кому сообщать об изменении самочувствия. Попросите ответить письменно или дать ссылки на актуальные страницы. Так сравнение будет опираться на одинаковые критерии.` ,
    `Итог\n\n${topic} — это прежде всего проверка профильности, медицинского маршрута и ограничений. Сначала подтвердите, что санаторий работает с нужным направлением, затем сопоставьте программу, документы, питание, длительность и бытовые условия. Финальное решение о допустимости поездки и назначениях принимайте вместе с врачом.`,
  ];

  return sections.filter((section, index, all) => {
    const heading = section.split("\n")[0].trim().toLocaleLowerCase("ru-RU");
    return all.findIndex((candidate) => candidate.split("\n")[0].trim().toLocaleLowerCase("ru-RU") === heading) === index;
  });
}

function topicAwareSanatoriumFormatSections(input: ReturnType<typeof normalizePayload>, brandName: string) {
  const topic = input.topic.trim();
  const profile = sanatoriumTopicProfile(input);
  const facts = listItems(input.useBrand ? input.brand.advantages : "");
  const focuses = parseEditorialFocuses(input.accent).filter((item) => item.required).map((item) => focusSection(item, input));

  if (isBrandMarketingTopic(input) && input.format === "seo") {
    return brandMarketingSanatoriumSections(input, brandName);
  }

  if (input.format === "social") {
    return [
      `${topic} — это не общий вопрос о выборе санатория. Сначала нужно подтвердить профиль по направлению ${profile.area} и понять, кто определяет допустимую программу.`,
      `До бронирования уточните: ${profile.question}. Перечень процедур сам по себе не показывает, подходит ли курс конкретному человеку.`,
      ...focuses.slice(0, 2),
      input.useBrand && facts.length ? `В профиле ${brandName} указаны ${naturalList(facts.slice(0, 3))}. Их применимость к конкретной задаче подтверждает врач после оценки состояния.` : "Опирайтесь на подтверждённые условия программы и медицинскую консультацию, а не на универсальные обещания.",
      "Сохраните эти вопросы перед разговором с санаторием и обсудите допустимость поездки со своим врачом.",
    ];
  }

  if (input.format === "ads") {
    return [
      `${topic}: начните с проверки профильной программы и консультации специалиста.`,
      input.useBrand && facts.length ? `${brandName}: ${naturalList(facts.slice(0, 2))}. Применимость процедур определяется индивидуально.` : `Уточните ${profile.specialist}, состав курса и необходимые документы.`,
      "Получите подтверждённую информацию о программе без дистанционных обещаний результата.",
    ];
  }

  if (input.format === "landing") {
    return [
      `${topic}\n\nПрофильная санаторная программа начинается с медицинской оценки, а не с универсального набора процедур. Уточните задачу, документы и ограничения до бронирования.`,
      `Профиль программы\n\nПроверьте направление ${profile.area}, участие специалиста и порядок первичной консультации.`,
      `Программа, собранная вокруг цели поездки\n\nКурс связывает ${profile.program}. Назначения и допустимую нагрузку определяют индивидуально.`,
      ...focuses.slice(0, 3),
      input.useBrand && facts.length ? `Подтверждённые особенности ${brandName}\n\n${naturalList(facts.slice(0, 4))}. Эти сведения не заменяют проверку показаний и противопоказаний.` : "Факты вместо обещаний\n\nПопросите подтвердить состав программы, медицинское сопровождение и условия путёвки.",
      `Следующий шаг\n\nПодготовьте актуальные медицинские документы и уточните у санатория: ${profile.question}.`,
    ];
  }

  return topicAwareSanatoriumSections(input, brandName);
}

function outputText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const candidate = response as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  };
  if (typeof candidate.output_text === "string") return candidate.output_text;

  return (candidate.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n");
}

function parseMaterial(text: string): GeneratedMaterial {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
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

function demoMaterial(input: ReturnType<typeof normalizePayload>, website: WebsiteContext): GeneratedMaterial {
  const brandName = input.useBrand && input.brand.name ? input.brand.name : "компания";
  const topic = cleanTopic(input.topic);
  const keyList = input.keywords.split(",").map((item) => item.trim()).filter(Boolean);
  const primaryKey = keyList[0] || topic.toLowerCase();
  const sanatorium = isSanatoriumContext(input);
  const title = topic;
  const requestedSignature = input.useBrand && input.format === "social" ? input.brand.signature : "";
  const signature = countWords(requestedSignature) <= Math.floor(input.length * 0.35) ? requestedSignature : "";
  const baseSections = sanatorium
    ? topicAwareSanatoriumFormatSections(input, brandName)
    : input.format === "social"
      ? genericSocialSections(topic)
      : input.format === "ads"
        ? genericAdSections(topic)
        : input.format === "landing"
          ? genericLandingSections(topic)
          : genericSections(topic, primaryKey);
  const keywordSections = sanatorium && input.format === "seo"
    ? keywordCoverageSections(input, brandName, sanatoriumTopicProfile(input), baseSections)
    : [];
  const keywordEnhancedSections = baseSections.length
    ? [baseSections[0], ...keywordSections, ...baseSections.slice(1)]
    : baseSections;
  const geographySection = demoGeographySection(input);
  const sections = geographySection && keywordEnhancedSections.length
    ? [keywordEnhancedSections[0], geographySection, ...keywordEnhancedSections.slice(1)]
    : keywordEnhancedSections;
  const signatureWords = countWords(signature);
  const coreTarget = Math.max(1, input.length - signatureWords);
  const coreBody = fitDemoLength(sections, coreTarget);
  const body = signature ? `${coreBody}\n\n${signature}` : coreBody;
  const actualWords = countWords(body);
  const editorialFocuses = parseEditorialFocuses(input.accent).filter((item) => item.required);

  return {
    title,
    body,
    metaTitle: title.slice(0, 70),
    metaDescription: sanatorium
      ? isBrandMarketingTopic(input)
        ? `${topic}: профильное направление, сильные стороны курорта, программа, лечебные факторы и подготовка к поездке.`.slice(0, 160)
        : `${topic}: как проверить профиль санатория, медицинское сопровождение, состав программы, ограничения и условия поездки.`.slice(0, 160)
      : `${topic}: критерии выбора, проверка условий и понятный следующий шаг.`.slice(0, 160),
    editorialComment: `Тестовый режим применил контракт «${FORMAT_PLANS[input.format].title}» и сохранил предмет темы «${input.topic}» в композиции материала. ${editorialFocuses.length ? `Использованы редакционные ориентиры матрицы: ${editorialFocuses.map((item) => item.label).join(", ")}. ` : ""}Сформировано ${actualWords.toLocaleString("ru-RU")} слов при цели ${input.length.toLocaleString("ru-RU")}; ${websiteSourceLabel(website)}. Перед размещением проверьте медицинские сведения и актуальные условия.`,
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

    const website = input.useBrand ? await readWebsiteContext(input.brand.website) : await readWebsiteContext("");
    const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
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
        format_rule: activeFormatRule(input.brand, input.format),
      } : null,
      website_snapshot: input.useBrand && website.status === "loaded"
        ? { url: website.resolvedUrl, text: website.text }
        : null,
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
        max_output_tokens: Math.min(24000, Math.max(3500, input.length * 4)),
        text: {
          verbosity: input.length >= 1800 ? "high" : input.length <= 300 ? "low" : "medium",
          format: { type: "json_schema", name: "klio_generated_material", strict: true, schema: MATERIAL_SCHEMA },
        },
        instructions: [
          "Ты — старший русскоязычный редактор и контент‑маркетолог платформы КЛИО.",
          "Создай готовый к публикации материал по брифу и верни только валидный JSON без Markdown-ограждений.",
          ...UNIVERSAL_EDITORIAL_RULES,
          `Контракт выбранного формата «${formatPlan.title}» обязателен и важнее стилистической окраски:`,
          ...formatPlan.aiRules,
          "Тема — главный контракт материала. Сначала выдели конкретный предмет запроса, затем построй вокруг него вступление, подзаголовки, аргументацию и финал.",
          "Перед написанием классифицируй коммуникационную задачу по формулировке темы и брифу: рассказать о конкретном бренде/продукте/услуге, дать экспертный ответ, сформировать спрос, снять возражение или привести к действию. Не выбирай автоматически формат инструкции.",
          "Если тема содержит название активного бренда, компании, продукта, программы или услуги, создай маркетинговый материал именно об этом предложении: раскрой его релевантность задаче аудитории, подтверждённые сильные стороны, программу или процесс и следующий шаг. Не подменяй такую тему инструкцией по выбору категории.",
          "Не переносить примеры, отраслевые признаки, терминологию, структуру и факты из других запросов. Тема про финансы, технологии, образование, недвижимость или любую иную сферу должна оставаться в своей сфере во всех разделах.",
          "Недопустимо упомянуть конкретный предмет только в заголовке, Title или первом абзаце, а основной текст заменить общей статьёй о категории. Для длинного материала предмет должен содержательно раскрываться минимум в трёх разделах.",
          "Каждый элемент mandatory_editorial_focus с required_in_publication=true обязателен: раскрой его как самостоятельный смысловой тезис или содержательный раздел. Не пересказывай редакционную команду и не копируй структуру конкурентов.",
          "Если semantic_module передан, используй его для уточнения интента, ширины запросов, тематических кластеров и полноты ответа. Не превращай классификацию семантики в видимый читателю служебный текст.",
          "Если competitor_module передан, используй выбранные выводы как обязательные темы и точки дифференциации. Не копируй формулировки, порядок разделов или позиционирование конкурентов и не считай их сведения фактами активного бренда.",
          "Если для обязательного ориентира не хватает подтверждённых фактов, раскрой безопасную практическую часть — критерии проверки, вопросы, ограничения — и укажи дефицит фактов в editorial_comment. Не игнорируй ориентир молча.",
          `Правила выбранной интонации «${input.tone}»:`,
          ...selectedToneRules,
          "Следуй пользовательскому правилу формата из профиля, если оно не противоречит безопасности и контракту формата. Не используй выражения из prohibited. Фирменную подпись добавляй только когда она уместна для выбранного формата и прямо передана в профиле.",
          "Выбранная география описывает территорию поискового спроса и должна заметно влиять на готовый материал. Если список не пуст, естественно упомяни каждую территорию из geography_contract.required_mentions хотя бы один раз — как контекст аудитории, маршрута, спроса или выбора.",
          "География спроса не доказывает, что бренд находится, работает или имеет филиал в этих местах. Не превращай её в факт о компании и не добавляй неподтверждённую локализацию.",
          "Поля source_facts и hidden_editorial_controls — внутренний бриф, а не содержание публикации. Никогда не пересказывай устройство брифа, профиль бренда, описание аудитории, выбранный стиль, ключевые слова или правила формата.",
          "Не используй мета-фразы «материал адресован», «текст говорит», «профиль бренда», «выбранный стиль», «ключевые темы» и подобные редакционные пояснения.",
          "Факты и преимущества вплетай в тему естественно. Позиционирование можно переформулировать; не копируй его отдельным рекламным абзацем.",
          "Выполни keyword_contract: каждая required_phrases должна присутствовать в body хотя бы один раз в точной или грамматически корректной форме. Не выдавай ключи списком и не комментируй SEO‑настройки. Соблюдай целевой объём строго, с допуском не более 5%.",
          "Не добивай текст вариациями одного ключа. Поисковые формулировки нужны для ясного соответствия интенту, а не для плотности: при конфликте с естественностью используй грамматически корректную форму и сохрани смысл.",
          "Материал должен добавлять собственную пользу: предметное объяснение, подтверждённые факты бренда, практический вывод или решение задачи. Не пересказывай абстрактно то, что могло бы относиться к любой компании.",
          "Для медицинской тематики избегай гарантий результата, диагнозов и персональных назначений.",
          "Структура JSON: title, body, meta_title, meta_description, editorial_comment. Все значения — строки.",
          "body должен быть цельным русским текстом с абзацами и уместными подзаголовками без служебных комментариев.",
          "editorial_comment кратко объясняет использованный ракурс, соблюдение голоса бренда и возможные места для фактчекинга; он не является частью статьи.",
        ].join("\n"),
        input: `Подготовь материал по этому брифу:\n${userBrief}`,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("OpenAI generation failed", aiResponse.status, errorText.slice(0, 1200));
      return Response.json(
        { error: "AI-редакция временно не ответила. Попробуйте ещё раз." },
        { status: 502 },
      );
    }

    const responseBody = await aiResponse.json();
    let material = parseMaterial(outputText(responseBody));
    const minimumWords = Math.floor(input.length * 0.95);
    const maximumWords = Math.ceil(input.length * 1.05);
    let missingGeo = missingGeography(material, input);
    let subjectCheck = topicCoverage(material, input);
    let missingFocuses = missingEditorialFocuses(material, input);
    let missingKeyPhrases = missingKeywords(material, input);

    if (countWords(material.body) < minimumWords || countWords(material.body) > maximumWords || hasMetaLeakage(material.body) || missingGeo.length || !subjectCheck.passes || missingFocuses.length || missingKeyPhrases.length) {
      const correctionResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: "low" },
          max_output_tokens: Math.min(24000, Math.max(3500, input.length * 4)),
          text: {
            verbosity: "high",
            format: { type: "json_schema", name: "klio_corrected_material", strict: true, schema: MATERIAL_SCHEMA },
          },
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
        }),
      });

      if (correctionResponse.ok) {
        const correctedBody = await correctionResponse.json();
        material = parseMaterial(outputText(correctedBody));
        missingGeo = missingGeography(material, input);
        subjectCheck = topicCoverage(material, input);
        missingFocuses = missingEditorialFocuses(material, input);
        missingKeyPhrases = missingKeywords(material, input);
      }
    }

    const actualWords = countWords(material.body);
    if (actualWords < minimumWords || actualWords > maximumWords) {
      return Response.json(
        { error: `AI‑редакция получила ${actualWords} слов вместо ${input.length}. Материал не принят — запустите генерацию ещё раз.` },
        { status: 422 },
      );
    }

    if (hasMetaLeakage(material.body)) {
      return Response.json(
        { error: "AI‑редакция обнаружила в тексте служебные формулировки. Материал не принят — запустите генерацию ещё раз." },
        { status: 422 },
      );
    }

    if (missingGeo.length) {
      return Response.json(
        { error: `AI‑редакция не применила выбранную географию: ${missingGeo.join(", ")}. Материал не принят — запустите генерацию ещё раз.` },
        { status: 422 },
      );
    }

    if (!subjectCheck.passes) {
      return Response.json(
        { error: `AI‑редакция не раскрыла предмет темы «${input.topic}» в основном тексте. Материал не принят — запустите генерацию ещё раз.` },
        { status: 422 },
      );
    }

    if (missingFocuses.length) {
      return Response.json(
        { error: `AI‑редакция не применила обязательные ориентиры: ${missingFocuses.map((item) => item.label).join(", ")}. Материал не принят — запустите генерацию ещё раз.` },
        { status: 422 },
      );
    }

    if (missingKeyPhrases.length) {
      return Response.json(
        { error: `AI‑редакция не использовала выбранные ключевые фразы: ${missingKeyPhrases.join(", ")}. Материал не принят — запустите генерацию ещё раз.` },
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
    return Response.json({ material, mode: "ai", model, coverage: coverageSummary(material, input), sources: { website: website.status, geography: input.geography.map((item) => item.label) }, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Generation route failed", error);
    return Response.json(
      { error: "Не удалось сформировать материал. Проверьте поля и повторите попытку." },
      { status: 500 },
    );
  }
}
