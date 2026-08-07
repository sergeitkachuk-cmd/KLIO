"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { russianGeoTree } from "./geo-data";
import { ADAPTATION_PLANS, FORMAT_PLANS, TONE_PLANS } from "./content-plans";
import { PLAN_RULES, type PlanId } from "./plans";

type Format = "seo" | "social" | "ads" | "landing";
type GenerationMode = "example" | "demo" | "ai";
type BrandTab = "foundation" | "voice" | "formats";
type ProfileMode = "quick" | "expert";
type SemanticMode = "idle" | "demo" | "ai";
type AiConnection = "checking" | "connected" | "disconnected";
type CompetitorMode = "example" | "demo" | "ai";
type CompetitorFocusSource = "manual" | "semantics" | "brand";
type ContentPlanMode = "idle" | "demo" | "ai";
type ContentPlanStatus = "Запланировано" | "В работе" | "Готово";
const CONTENT_PLAN_STATUS_OPTIONS = [
  { value: "Запланировано", label: "Запланировано" },
  { value: "В работе", label: "В работе" },
  { value: "Готово", label: "Готово" },
];
type AdaptationGoal = keyof typeof ADAPTATION_PLANS;
type AdaptationMode = "example" | "demo" | "ai";

type SemanticGeo = { cityIds: string[] };

type LegacySemanticGeo = Record<"district" | "region" | "city", { enabled: boolean; value: string }>;

type GeoScope = {
  key: string;
  label: string;
  detail: string;
  cityIds: string[];
};

type SemanticKeyword = {
  id: string;
  phrase: string;
  cluster: string;
  intent: "Информационный" | "Коммерческий" | "Транзакционный" | "Смешанный" | "Навигационный";
  role: "Основной" | "Поддерживающий" | "Вопрос" | "Гео";
  relation: "Ядро" | "Синоним" | "Проблема" | "Решение" | "Смежный" | "Вопрос" | "Бренд" | "Гео";
  breadth: "Широкий" | "Средний" | "Узкий";
  recommended: boolean;
  note?: string;
};

type SemanticResult = {
  primaryQuery: string;
  intent: {
    label: string;
    stage: string;
    summary: string;
  };
  suggestedTopic: string;
  recommendedLength: number;
  dataNote: string;
  keywords: SemanticKeyword[];
};

type CompetitorEntry = {
  id: string;
  label: string;
  url: string;
  origin?: "manual" | "ai";
};

type CompetitorCoverage = "strong" | "partial" | "missing" | "unknown";

type CompetitorSource = CompetitorEntry & {
  status: "loaded" | "unavailable" | "blocked" | "example";
};

type CompetitorTopic = {
  id: string;
  title: string;
  cluster: string;
  priority: "Высокий" | "Средний" | "Дополнительный";
  rationale: string;
  brandCoverage: CompetitorCoverage;
  coverage: Record<string, CompetitorCoverage>;
  opportunity: string;
  recommended: boolean;
};

type CompetitorResult = {
  query: string;
  competitors: CompetitorSource[];
  topics: CompetitorTopic[];
  commonTopics: string[];
  gaps: string[];
  suggestedTitle: string;
  suggestedStructure: string[];
  dataNote: string;
};

type ContentPlanItem = {
  id: string;
  title: string;
  cluster: string;
  format: "SEO‑статья" | "Экспертный разбор" | "FAQ" | "Сравнение" | "Кейс" | "Посадочная страница" | "Рекламный текст" | "Пост";
  intent: "Информационный" | "Коммерческий" | "Транзакционный" | "Смешанный" | "Навигационный";
  stage: "Знакомство" | "Выбор" | "Решение" | "Удержание";
  priority: "Высокий" | "Средний" | "Дополнительный";
  angle: string;
  objective: string;
  primaryKeyword: string;
  lsi: string[];
  audience: string;
  metaTitle: string;
  metaDescription: string;
  structure: string[];
  cta: string;
  evidenceNeeded: string[];
  sources: string[];
  status: ContentPlanStatus;
};

type ContentPlanResult = {
  query: string;
  items: ContentPlanItem[];
  clusters: string[];
  dataNote: string;
};

type ContentPlanGoal = "mixed" | "seo" | "social" | "landing" | "ads";

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

type GeneratedMaterial = {
  title: string;
  body: string;
  metaTitle: string;
  metaDescription: string;
  editorialComment: string;
};

type GenerationCoverage = {
  topic: string;
  subjectApplied: boolean;
  subjectSections: number;
  editorialFocusTotal: number;
  editorialFocusApplied: string[];
  editorialFocusMissing: string[];
  geographyApplied: string[];
  keywordTotal: number;
  keywordApplied: string[];
  keywordMissing: string[];
};

type AdaptedMaterial = GeneratedMaterial & {
  changes: string[];
};

type WorkspaceAccount = {
  planId: PlanId;
  planName: string;
  generationsUsed: number;
  generationLimit: number;
  generationsRemaining: number;
  researchUsed: number;
  researchLimit: number;
  researchRemaining: number;
  editorActionsUsed: number;
  editorActionLimit: number;
  editorActionsRemaining: number;
  brandCount: number;
  brandLimit: number;
  seatLimit: 1;
  period: string;
};

type BrandWorkspaceSnapshot = {
  useBrand?: boolean;
  profileMode?: ProfileMode;
  semantics?: {
    query?: string;
    geo?: SemanticGeo;
    result?: SemanticResult;
    selectedIds?: string[];
    mode?: SemanticMode;
    needsRefresh?: boolean;
  };
  competitors?: {
    query?: string;
    focusSource?: CompetitorFocusSource;
    entries?: CompetitorEntry[];
    comment?: string;
    result?: CompetitorResult;
    selectedIds?: string[];
    mode?: CompetitorMode;
    needsRefresh?: boolean;
  };
  contentPlan?: {
    query?: string;
    count?: number;
    result?: ContentPlanResult;
    mode?: ContentPlanMode;
    needsRefresh?: boolean;
  };
  generator?: {
    format?: Format;
    topic?: string;
    keywords?: string;
    tone?: string;
    length?: number;
    customLength?: boolean;
    accent?: string;
    title?: string;
    body?: string;
    metaTitle?: string;
    metaDescription?: string;
    editorNote?: string;
    generationMode?: GenerationMode;
    coverage?: GenerationCoverage | null;
    useBrandContext?: boolean;
    useSemanticContext?: boolean;
    useCompetitorContext?: boolean;
  };
  adaptation?: {
    source?: string;
    goal?: AdaptationGoal;
    tone?: string;
    keywords?: string;
    instructions?: string;
    result?: AdaptedMaterial | null;
    mode?: AdaptationMode;
  };
};

type WorkspaceBrand = {
  id: string;
  name: string;
  website: string;
  profile: BrandProfile;
  workspace: BrandWorkspaceSnapshot;
  updatedAt: string;
};

type GenerationArchiveItem = {
  id: string;
  brandId: string | null;
  format: Format;
  topic: string;
  title: string;
  body: string;
  metaTitle: string;
  metaDescription: string;
  editorialComment: string;
  keywords: string;
  tone: string;
  targetLength: number;
  createdAt: string;
};

type SavedMaterialType = "semantics" | "competitors" | "content_plan";
type MaterialsFilter = "all" | "article" | SavedMaterialType;
type MaterialsDateRange = "all" | "today" | "yesterday" | "week" | "month" | "lastMonth" | "quarter" | "year";

const MATERIALS_DATE_RANGE_OPTIONS: { value: MaterialsDateRange; label: string }[] = [
  { value: "all", label: "Все даты" },
  { value: "today", label: "Сегодня" },
  { value: "yesterday", label: "Вчера" },
  { value: "week", label: "Эта неделя" },
  { value: "month", label: "Этот месяц" },
  { value: "lastMonth", label: "Прошлый месяц" },
  { value: "quarter", label: "Этот квартал" },
  { value: "year", label: "Год" },
];

function isWithinMaterialsDateRange(value: string, range: MaterialsDateRange): boolean {
  if (range === "all") return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  const now = new Date();
  const startOfDay = (source: Date) => new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const today = startOfDay(now);
  const itemDay = startOfDay(date);

  if (range === "today") return itemDay.getTime() === today.getTime();
  if (range === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return itemDay.getTime() === yesterday.getTime();
  }
  if (range === "week") {
    const offset = (today.getDay() + 6) % 7; // Monday-start week
    const monday = new Date(today);
    monday.setDate(monday.getDate() - offset);
    return itemDay.getTime() >= monday.getTime();
  }
  if (range === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (range === "lastMonth") {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth();
  }
  if (range === "quarter") return date.getFullYear() === now.getFullYear() && Math.floor(date.getMonth() / 3) === Math.floor(now.getMonth() / 3);
  if (range === "year") return date.getFullYear() === now.getFullYear();
  return true;
}

type SavedWorkspaceMaterial = {
  id: string;
  brandId: string;
  type: SavedMaterialType;
  title: string;
  status: string;
  payload: Record<string, unknown>;
  groupId: string;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
};

type ContentPlanReplacement = {
  sourceId: string;
  alternatives: ContentPlanItem[];
};

const defaultBrand: BrandProfile = {
  name: "Санаторий «Марциальные воды»",
  website: "marcwater.com",
  description: "Бальнеологический санаторий в Карелии, первый российский курорт. Лечение, реабилитация и восстановление круглый год.",
  positioning: "Исторический курорт с сильной медицинской базой, природными лечебными факторами и внимательным отношением к гостю.",
  audience: "Взрослые 35–70 лет: санаторное лечение, восстановление после нагрузки, профилактика и спокойный отдых в Карелии.",
  advantages: "Программа «Здоровый позвоночник»: бассейн, озонотерапия, подводное вытяжение позвоночника, ручной массаж, габозерские лечебные грязи и тренажёр Маркелова; курс программы «Здоровый позвоночник» — 13 суток; для программы требуется МРТ не старше одного года и полужёсткий корсет; марциальная железистая вода; габозерские лечебные грязи; медицинские специалисты; широкий набор процедур; историческое наследие первого российского курорта; природа Карелии.",
  voice: "Экспертно, понятно и доброжелательно. Сложное объяснять простыми словами, без канцеляризмов и рекламного давления.",
  restrictions: "Не обещать исцеление, не ставить диагнозы, не придумывать показания, цены, сроки и медицинские факты.",
  signature: "С заботой о вашем здоровье и отдыхе, санаторий «Марциальные воды» — первый российский курорт.",
  prohibited: "гарантированное исцеление; чудодейственный; лучший санаторий; уникальный результат; успейте любой ценой",
  seoRules: "Полно отвечать на поисковый запрос, использовать ясные подзаголовки, естественно распределять ключевые фразы и не допускать медицинских обещаний без подтверждения.",
  socialRules: "Говорить от лица санатория. Один главный тезис, короткие абзацы, спокойный дружелюбный призыв и фирменная подпись в финале.",
  adsRules: "Конкретная польза без давления, ложной срочности и превосходных степеней. Один понятный следующий шаг.",
  landingRules: "Сначала задача гостя, затем решение, факты и маршрут обращения. Услуги, сроки и цены не придумывать.",
};

const defaultSemanticResult: SemanticResult = {
  primaryQuery: "",
  intent: {
    label: "",
    stage: "",
    summary: "",
  },
  suggestedTopic: "",
  recommendedLength: 1200,
  dataNote: "",
  keywords: [],
};

const defaultCompetitors: CompetitorEntry[] = [
  { id: "competitor-1", label: "Конкурент 1", url: "" },
  { id: "competitor-2", label: "Конкурент 2", url: "" },
  { id: "competitor-3", label: "Конкурент 3", url: "" },
];

const defaultCompetitorResult: CompetitorResult = {
  query: "санаторий для восстановления",
  competitors: [
    { id: "example-a", label: "Санаторий A", url: "Демонстрационная страница", status: "example" },
    { id: "example-b", label: "Санаторий B", url: "Демонстрационная страница", status: "example" },
    { id: "example-c", label: "Санаторий C", url: "Демонстрационная страница", status: "example" },
  ],
  topics: [
    {
      id: "choice",
      title: "Критерии выбора санатория",
      cluster: "Выбор",
      priority: "Высокий",
      rationale: "Напрямую отвечает на поисковый интент и помогает читателю сравнить варианты.",
      brandCoverage: "partial",
      coverage: { "example-a": "strong", "example-b": "partial", "example-c": "missing" },
      opportunity: "Собрать критерии в понятный чек‑лист и связать их с подтверждёнными фактами бренда.",
      recommended: true,
    },
    {
      id: "medical",
      title: "Медицинский профиль и специалисты",
      cluster: "Лечение",
      priority: "Высокий",
      rationale: "Показывает, соответствует ли предложение задаче восстановления.",
      brandCoverage: "strong",
      coverage: { "example-a": "strong", "example-b": "strong", "example-c": "partial" },
      opportunity: "Не перечислять всё подряд, а объяснить роль специалистов в выборе программы.",
      recommended: true,
    },
    {
      id: "program",
      title: "Состав программы и процедур",
      cluster: "Лечение",
      priority: "Высокий",
      rationale: "Одна из главных коммерческих тем перед бронированием.",
      brandCoverage: "partial",
      coverage: { "example-a": "strong", "example-b": "partial", "example-c": "strong" },
      opportunity: "Показать логику назначения процедур, не придумывая состав конкретной путёвки.",
      recommended: true,
    },
    {
      id: "nature",
      title: "Природные лечебные факторы",
      cluster: "Преимущества",
      priority: "Средний",
      rationale: "Помогает отличить курортное предложение от обычного размещения.",
      brandCoverage: "strong",
      coverage: { "example-a": "partial", "example-b": "missing", "example-c": "partial" },
      opportunity: "Раскрыть подтверждённые природные факторы как сильный смысловой акцент бренда.",
      recommended: true,
    },
    {
      id: "documents",
      title: "Документы и подготовка к поездке",
      cluster: "Подготовка",
      priority: "Средний",
      rationale: "Снимает практические вопросы и повышает полезность материала.",
      brandCoverage: "missing",
      coverage: { "example-a": "missing", "example-b": "partial", "example-c": "missing" },
      opportunity: "Свободная тема: добавить проверяемый список вопросов до бронирования.",
      recommended: true,
    },
    {
      id: "booking",
      title: "Стоимость и условия бронирования",
      cluster: "Решение",
      priority: "Средний",
      rationale: "Поддерживает коммерческую часть интента.",
      brandCoverage: "partial",
      coverage: { "example-a": "strong", "example-b": "strong", "example-c": "partial" },
      opportunity: "Указать только доступные условия или сформулировать вопросы для уточнения.",
      recommended: false,
    },
  ],
  commonTopics: ["Медицинский профиль", "Состав программы", "Условия бронирования"],
  gaps: ["Документы до поездки", "Логика выбора процедур", "Роль природных факторов"],
  suggestedTitle: "Как выбрать санаторий для восстановления: критерии и вопросы до бронирования",
  suggestedStructure: [
    "С какой цели начинается выбор",
    "Как проверить медицинский профиль",
    "Что важно узнать о программе",
    "Какие документы подготовить",
    "Что уточнить до бронирования",
  ],
  dataNote: "Сейчас показан демонстрационный пример. Добавьте 2–5 ссылок: КЛИО прочитает доступные страницы и отдельно отметит те, которые не удалось проверить.",
};

const emptyCompetitorResult: CompetitorResult = {
  query: "",
  competitors: [],
  topics: [],
  commonTopics: [],
  gaps: [],
  suggestedTitle: "Матрица появится после анализа",
  suggestedStructure: [],
  dataNote: "Добавьте 2–5 открытых страниц по текущей теме и запустите анализ.",
};

const emptyContentPlanResult: ContentPlanResult = {
  query: "",
  items: [],
  clusters: [],
  dataNote: "",
};

const geoCityId = (region: string, city: string) => `${region}::${city}`;
const geoRegionIndex = new Map(
  russianGeoTree.flatMap((district) => district.regions.map((region) => [region.name, { district: district.name, region }] as const)),
);
const geoDistrictIndex = new Map(russianGeoTree.map((district) => [district.name, district] as const));
const allGeoCityIds = new Set(
  russianGeoTree.flatMap((district) => district.regions.flatMap((region) => region.cities.map((city) => geoCityId(region.name, city)))),
);
const kareliaCityIds = geoRegionIndex.get("Республика Карелия")?.region.cities.map((city) => geoCityId("Республика Карелия", city)) ?? [];

const defaultSemanticGeo: SemanticGeo = { cityIds: kareliaCityIds };

function idsForRegion(regionName: string) {
  const region = geoRegionIndex.get(regionName)?.region;
  return region?.cities.map((city) => geoCityId(regionName, city)) ?? [];
}

function idsForDistrict(districtName: string) {
  const district = geoDistrictIndex.get(districtName);
  return district?.regions.flatMap((region) => region.cities.map((city) => geoCityId(region.name, city))) ?? [];
}

function geoSelectionState(selected: Set<string>, ids: string[]) {
  const count = ids.reduce((total, id) => total + (selected.has(id) ? 1 : 0), 0);
  return { checked: ids.length > 0 && count === ids.length, mixed: count > 0 && count < ids.length };
}

function semanticGeoScopes(geo: SemanticGeo): GeoScope[] {
  const selected = new Set(geo.cityIds.filter((id) => allGeoCityIds.has(id)));
  const scopes: GeoScope[] = [];

  for (const district of russianGeoTree) {
    const districtIds = idsForDistrict(district.name);
    const districtState = geoSelectionState(selected, districtIds);
    if (districtState.checked) {
      scopes.push({
        key: `district:${district.name}`,
        label: district.name,
        detail: `${district.regions.length} регионов`,
        cityIds: districtIds,
      });
      continue;
    }

    for (const region of district.regions) {
      const regionIds = idsForRegion(region.name);
      const regionState = geoSelectionState(selected, regionIds);
      if (regionState.checked) {
        scopes.push({
          key: `region:${region.name}`,
          label: region.name,
          detail: district.name.replace(" федеральный округ", " ФО"),
          cityIds: regionIds,
        });
        continue;
      }

      for (const city of region.cities) {
        const id = geoCityId(region.name, city);
        if (!selected.has(id)) continue;
        scopes.push({
          key: `city:${id}`,
          label: city,
          detail: region.name,
          cityIds: [id],
        });
      }
    }
  }

  return scopes;
}

function normalizeStoredGeo(value: unknown, fallbackRegion?: string): SemanticGeo {
  if (value && typeof value === "object" && Array.isArray((value as { cityIds?: unknown }).cityIds)) {
    const cityIds = (value as { cityIds: unknown[] }).cityIds
      .filter((id): id is string => typeof id === "string" && allGeoCityIds.has(id));
    return { cityIds: [...new Set(cityIds)] };
  }

  const legacy = value as Partial<LegacySemanticGeo> | null;
  const selected = new Set<string>();
  if (legacy?.district?.enabled) idsForDistrict(legacy.district.value).forEach((id) => selected.add(id));
  if (legacy?.region?.enabled) idsForRegion(legacy.region.value).forEach((id) => selected.add(id));
  if (legacy?.city?.enabled) {
    const preferredRegion = legacy.region?.value || fallbackRegion || "";
    const preferredId = geoCityId(preferredRegion, legacy.city.value);
    if (allGeoCityIds.has(preferredId)) selected.add(preferredId);
    else {
      const matchingId = [...allGeoCityIds].find((id) => id.endsWith(`::${legacy.city?.value}`));
      if (matchingId) selected.add(matchingId);
    }
  }
  if (!selected.size && fallbackRegion) idsForRegion(fallbackRegion).forEach((id) => selected.add(id));
  return selected.size ? { cityIds: [...selected] } : defaultSemanticGeo;
}

const adaptationGoalIds: AdaptationGoal[] = [
  "proofread", "clarity", "rewrite", "shorten", "opening", "closing",
  "review", "social", "seo", "landing", "ads", "cold_email",
];

const adaptationGoals: { id: AdaptationGoal; label: string; detail: string }[] = adaptationGoalIds
  .map((id) => ({ id, label: ADAPTATION_PLANS[id].title, detail: ADAPTATION_PLANS[id].detail }));

function isAdaptationGoal(value: unknown): value is AdaptationGoal {
  return typeof value === "string" && adaptationGoalIds.includes(value as AdaptationGoal);
}

const defaultAdaptationSource = `Как выбрать санаторий для восстановления

При выборе санатория многие смотрят прежде всего на стоимость путёвки и фотографии номеров. Однако для восстановления важно учитывать медицинский профиль здравницы, природные лечебные факторы, квалификацию специалистов и состав программы.

Санаторий «Марциальные воды» находится в Карелии и является первым российским курортом. Здесь используются марциальная железистая вода и габозерские лечебные грязи, работают медицинские специалисты, доступны программы лечения, профилактики и восстановления.

Перед бронированием стоит уточнить, какие документы потребуются, что входит в путёвку, как назначаются процедуры и можно ли скорректировать программу после консультации врача. Также имеют значение питание, расположение корпусов и продолжительность курса.`;

const legacyDefaultFields: Partial<Record<keyof BrandProfile, string>> = {
  description: "Первый российский курорт в Карелии. Бальнеологический санаторий с сильной медицинской базой, природными лечебными факторами и программами лечения, реабилитации и восстановления круглый год.",
  positioning: "Санаторий с историей и душой: опытный и заботливый хозяин помогает гостю подобрать понятный путь к лечению, восстановлению и спокойному отдыху в Карелии.",
  audience: "Взрослые 35–70 лет, которые выбирают санаторное лечение, восстановление после нагрузки, профилактические программы и спокойный отдых в Карелии.",
  voice: "Экспертно, понятно, доброжелательно и располагающе. Объяснять пользу без перегруженной медицинской терминологии. В финале уместна короткая фирменная подпись от санатория.",
  restrictions: "Не обещать гарантированное лечение или исцеление. Не ставить диагнозы. Не придумывать показания, цены, сроки программ и медицинские факты. Избегать канцеляризмов и агрессивных продаж.",
};

function migrateStoredBrand(profile: BrandProfile) {
  const migrated = { ...profile };
  (Object.keys(legacyDefaultFields) as Array<keyof BrandProfile>).forEach((field) => {
    if (profile[field] === legacyDefaultFields[field]) migrated[field] = defaultBrand[field];
  });
  return migrated;
}

function buildVoiceRecommendations(profile: BrandProfile): Pick<BrandProfile, "voice" | "restrictions" | "signature" | "prohibited"> {
  const brandName = profile.name.trim() || "Бренд";

  return {
    voice: "Экспертно, понятно и доброжелательно. Коротко объяснять сложное, опираться на факты, избегать канцеляризмов и давления.",
    restrictions: "Не придумывать цены, сроки, характеристики и результаты. Не давать гарантий без подтверждения. Спорные сведения оставлять на проверку специалисту.",
    signature: `С заботой о вас, ${brandName}.`,
    prohibited: "гарантированный результат; лучший на рынке; уникальный без доказательств; успейте любой ценой; никаких рисков; подходит всем",
  };
}

function buildFormatRecommendations(): Pick<BrandProfile, "seoRules" | "socialRules" | "adsRules" | "landingRules"> {
  return {
    seoRules: "Полно отвечать на поисковый запрос. Использовать ясные подзаголовки, естественные ключевые фразы и только проверяемые факты.",
    socialRules: "Один главный тезис на публикацию. Начинать с узнаваемой ситуации или пользы, писать короткими абзацами, говорить от лица бренда и завершать спокойным следующим шагом. Фирменную подпись добавлять только там, где она звучит естественно.",
    adsRules: "Одна конкретная выгода и один понятный призыв. Не использовать давление, ложную срочность, неподтверждённые превосходные степени и обещания результата. Формулировки должны быть короткими и проверяемыми.",
    landingRules: "Сначала показать задачу клиента, затем решение, подтверждающие факты и следующий шаг. Не придумывать условия и не перегружать первый экран деталями.",
  };
}

const formats: { id: Format; label: string }[] = [
  { id: "seo", label: "SEO‑статья" },
  { id: "social", label: "Пост для соцсетей" },
  { id: "ads", label: "Рекламный текст" },
  { id: "landing", label: "Текст для сайта" },
];

const styles = Object.keys(TONE_PLANS);

const lengthPresets: Record<Format, { value: number; label: string }[]> = {
  seo: [
    { value: 500, label: "500 · заметка" },
    { value: 800, label: "800 · краткая статья" },
    { value: 1200, label: "1 200 · стандарт" },
    { value: 1800, label: "1 800 · подробно" },
    { value: 2500, label: "2 500 · лонгрид" },
    { value: 4000, label: "4 000 · спецпроект" },
  ],
  social: [
    { value: 80, label: "80 · очень короткий" },
    { value: 150, label: "150 · оптимальный" },
    { value: 300, label: "300 · развёрнутый" },
    { value: 500, label: "500 · экспертный" },
  ],
  ads: [
    { value: 50, label: "50 · короткий" },
    { value: 100, label: "100 · стандарт" },
    { value: 200, label: "200 · подробно" },
    { value: 300, label: "300 · серия тезисов" },
  ],
  landing: [
    { value: 300, label: "300 · один блок" },
    { value: 500, label: "500 · короткая страница" },
    { value: 800, label: "800 · стандарт" },
    { value: 1200, label: "1 200 · подробно" },
    { value: 1800, label: "1 800 · большая страница" },
  ],
};

const defaultLengthByFormat: Record<Format, number> = {
  seo: 1200,
  social: 150,
  ads: 100,
  landing: 500,
};

// Контент-план works with its own, more editorial set of formats (SEO-
// статья, кейс, FAQ...); the generator only knows the four production
// formats above. Without this map, "В генератор" always sent every plan
// item — including social posts — in as an SEO article at 1200 words,
// which is unusable for a "Пост" item. Anything long-form-article-shaped
// maps to seo; every format with a direct generator equivalent maps
// straight to it.
const contentPlanFormatToGeneratorFormat: Record<ContentPlanItem["format"], Format> = {
  "SEO‑статья": "seo",
  "Экспертный разбор": "seo",
  FAQ: "seo",
  Сравнение: "seo",
  Кейс: "seo",
  "Посадочная страница": "landing",
  "Рекламный текст": "ads",
  Пост: "social",
};

// What the whole plan is *for* — sent to /api/content-plan so the AI
// strategist either balances formats across the funnel as before
// ("mixed") or sticks to one production format throughout, matching how
// the person actually intends to use the plan (e.g. filling an SMM
// calendar shouldn't hand back landing-page topics).
const CONTENT_PLAN_GOALS: { id: ContentPlanGoal; label: string; hint: string }[] = [
  { id: "mixed", label: "Смешанный", hint: "КЛИО сама балансирует форматы по этапам воронки — как раньше." },
  { id: "seo", label: "SEO‑статьи", hint: "План только из статей для блога или сайта." },
  { id: "social", label: "Посты для соцсетей", hint: "План только из постов — готово для SMM‑календаря." },
  { id: "landing", label: "Посадочные страницы", hint: "План только из продающих лендингов." },
  { id: "ads", label: "Рекламные тексты", hint: "План только из коротких рекламных текстов." },
];

const sample: Record<Format, { title: string; body: string }> = {
  seo: {
    title: "Как выбрать санаторий для восстановления: практическое руководство",
    body: "Выбор санатория начинается не с фотографий номера, а с цели поездки. Восстановление после нагрузки, профилактика хронических состояний и реабилитация требуют разных программ — поэтому сначала стоит сопоставить медицинский профиль курорта со своими задачами.\n\nОбратите внимание на три блока: квалификацию специалистов, состав процедур и природные лечебные факторы. Сильная программа объединяет диагностику, дозированную нагрузку и отдых, а не предлагает одинаковый набор услуг каждому гостю.\n\nДо бронирования уточните, какие документы и результаты обследований понадобятся врачу. Это поможет использовать время поездки эффективнее и получить персональный план восстановления уже в первые дни.",
  },
  social: {
    title: "Отдых, после которого действительно больше сил",
    body: "Иногда организму нужен не насыщенный отпуск, а продуманная перезагрузка. Консультация врача, лечебные процедуры, прогулки и спокойный ритм помогают восстановить сон и вернуться к привычной жизни с новым ресурсом.\n\nВыберите программу под свою задачу — от короткого восстановительного курса до полноценного санаторного лечения.",
  },
  ads: {
    title: "Восстановление в Карелии — с программой под ваше здоровье",
    body: "Лечебные программы, природные факторы Карелии и сопровождение специалистов. Выберите продолжительность поездки и получите персональный план процедур. Узнайте свободные даты и рассчитайте стоимость отдыха.",
  },
  landing: {
    title: "Санаторное восстановление с вниманием к вашему состоянию",
    body: "Мы объединяем медицинскую экспертизу, природные лечебные ресурсы и спокойный ритм Карелии. Врач изучает ваши задачи и формирует индивидуальную программу процедур, чтобы каждый день поездки работал на результат.\n\nВыберите подходящее направление восстановления и получите предварительную консультацию специалиста.",
  },
};

const modules = [
  ["01", "Профиль компании", "Загрузите PDF, описание бизнеса, скриншоты сайта и примеры текстов. КЛИО определит аудиторию, УТП, услуги и тон коммуникации — все материалы будут звучать как ваш бренд."],
  ["02", "Ключи и поисковый интент", "Введите основной запрос, выберите географию и получите связанные фразы по смысловым группам. КЛИО отделит полезную семантику от формулировок, которые ведут к переспаму."],
  ["03", "Анализ конкурентов · по желанию", "Необязательный углублённый режим для SEO‑задач: добавьте 2–5 прямых страниц, найдите смысловые пробелы и при необходимости передайте выбранные выводы в дополнительный акцент материала."],
  ["04", "Готовая статья по ключам", "Выберите ключевые слова, объём и стиль. Сервис подготовит цельный материал с SEO‑заголовком, метаописанием, подзаголовками и естественным распределением семантики."],
  ["05", "Контент‑план", "Получите план на 10, 15 или 25 материалов: SEO‑заголовок, метаописание, основной запрос, поддерживающая семантика, аудитория, цель и структура. Меняйте статусы, передавайте темы в генератор и экспортируйте CSV."],
  ["06", "Редакторы КЛИО", "Двенадцать фирменных сценариев: от вычитки и ясности до SEO‑пересборки, поста, рекламы и первого делового контакта."],
];

const audiences = [
  {
    number: "01",
    title: "Владельцам бизнеса",
    text: "Чтобы регулярно выходить в поиск и соцсети без отдельной редакции: КЛИО превращает задачи бизнеса в готовые материалы с единым голосом бренда.",
    result: "Системный контент без расширения штата",
  },
  {
    number: "02",
    title: "Маркетологам",
    text: "Чтобы связать семантику, анализ конкурентов, контент‑план и производство текстов в одном управляемом процессе.",
    result: "От поискового спроса — к публикации",
  },
  {
    number: "03",
    title: "Экспертам и авторам",
    text: "Чтобы масштабировать собственную экспертизу, сохраняя интонацию, фактуру и узнаваемый авторский стиль.",
    result: "Ваши идеи звучат как ваши",
  },
  {
    number: "04",
    title: "Агентствам",
    text: "Чтобы вести несколько брендов, согласовывать материалы с клиентами и выпускать больше контента без потери качества.",
    result: "Больше проектов в одной редакции",
  },
];

const faq = [
  {
    question: "КЛИО просто генерирует текст по одному запросу?",
    answer: "Нет. Платформа учитывает профиль компании, поисковый спрос, материалы конкурентов, выбранные ключи, формат и голос бренда. Поэтому результат формируется как редакционный материал под конкретную бизнес‑задачу.",
  },
  {
    question: "Можно ли редактировать готовый материал?",
    answer: "Да. Заголовок и основной текст доступны для редактирования прямо в рабочем поле. Поле автоматически увеличивается по мере добавления текста, а после правок материал можно скопировать или экспортировать.",
  },
  {
    question: "Служебный комментарий копируется вместе со статьёй?",
    answer: "Нет. Параметры генерации и редакционный комментарий находятся в отдельном блоке и не входят в текст при копировании.",
  },
  {
    question: "Подходит ли сервис для нескольких компаний?",
    answer: "Да. Тариф «Профи» поддерживает до 5 брендов, «Агентство» — до 10. Статьи, семантика, планы и конкурентные исследования каждого бренда хранятся в его собственном разделе «Материалы». На всех тарифах предусмотрен доступ одного пользователя.",
  },
  {
    question: "Как расходуются лимиты?",
    answer: "Создание статьи, поста, рекламы или текста для сайта расходует один материал. Семантика, контент‑план и анализ конкурентов расходуют по одному исследованию. AI‑доработка текста или пакетная замена до пяти тем расходует одно редакторское действие. Ручные правки, сохранение, открытие, копирование и экспорт бесплатны.",
  },
  {
    question: "Можно ли начать без готового семантического ядра?",
    answer: "Да. Достаточно указать тему или основной запрос. КЛИО поможет собрать связанные ключи по интенту и ширине формулировки и использовать выбранную семантику в материале. Точные показатели спроса появляются только при подключённом поисковом источнике.",
  },
];

const pricing = [
  {
    name: "Старт",
    description: "Для эксперта и небольшого проекта",
    monthly: 990,
    yearly: 790,
    limit: "20 материалов · 10 исследований · 100 AI‑правок",
    planId: "start" as PlanId,
    features: ["SEO‑статьи и посты", "1 профиль бренда", "1 пользователь", "Базовая SEO‑проверка", "Материалы и экспорт"],
  },
  {
    name: "Профи",
    description: "Для маркетолога и контент‑команды",
    monthly: 2490,
    yearly: 1990,
    limit: "100 материалов · 50 исследований · 500 AI‑правок",
    planId: "pro" as PlanId,
    features: ["Все форматы контента", "5 профилей бренда", "1 пользователь", "Расширенная семантика", "Редакторы КЛИО для площадок"],
  },
  {
    name: "Агентство",
    description: "Для нескольких клиентов и процессов",
    monthly: 5990,
    yearly: 4790,
    planId: "agency" as PlanId,
    limit: "300 материалов · 150 исследований · 2 000 AI‑правок",
    features: ["10 профилей бренда", "1 пользователь", "Клиентское согласование", "Приоритетная генерация", "API и расширенный экспорт"],
    popular: true,
  },
];

const marqueeItems = ["SEO‑СТАТЬИ", "ПОСТЫ", "РЕКЛАМА", "КОНТЕНТ‑ПЛАН", "АНАЛИЗ КОНКУРЕНТОВ", "ПРОФИЛЬ БРЕНДА"];

const busySteps = ["Изучаем профиль бренда", "Проектируем структуру", "Собираем материал", "Проверяем результат"];

const competitorCoverageMeta: Record<CompetitorCoverage, { label: string }> = {
  strong: { label: "Раскрыто" },
  partial: { label: "Частично" },
  missing: { label: "Не найдено" },
  unknown: { label: "Не проверено" },
};

function normalizeForSearch(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
}

function uniqueText(values: string[]) {
  return values.filter((item, index, all) => {
    const normalized = normalizeForSearch(item.trim());
    return normalized && all.findIndex((candidate) => normalizeForSearch(candidate.trim()) === normalized) === index;
  });
}

function stemSearchWord(value: string) {
  const endings = ["иями", "ями", "ами", "его", "ого", "ему", "ому", "ими", "ыми", "иях", "ах", "ях", "ов", "ев", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ых", "их", "ую", "юю", "ом", "ем", "ам", "ям", "ы", "и", "а", "я", "у", "ю", "е", "о"];
  const ending = endings.find((candidate) => value.endsWith(candidate) && value.length - candidate.length >= 4);
  return ending ? value.slice(0, -ending.length) : value;
}

function searchTokens(value: string) {
  return normalizeForSearch(value)
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(stemSearchWord);
}

function containsKeyword(value: string, keyword: string) {
  const haystack = searchTokens(value);
  const needle = searchTokens(keyword);
  if (!needle.length || needle.length > haystack.length) return false;
  return haystack.some((_, index) => needle.every((token, offset) => haystack[index + offset] === token));
}

function compactUrl(value: string) {
  if (!/^https?:/i.test(value)) return value;
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

function brandComparisonTheme(brand: BrandProfile) {
  const category = (brand.description || brand.positioning)
    .split(/[.!?\n]/)
    .map((item) => item.trim())
    .find(Boolean) || "";
  return category ? `${brand.name}: ${category}`.slice(0, 260) : brand.name.slice(0, 260);
}

function comparableUrl(value: string) {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLocaleLowerCase("ru-RU");
  } catch {
    return value.trim().toLocaleLowerCase("ru-RU");
  }
}

function cleanContentPlanTitle(value: string) {
  const withoutBrackets = value
    .replace(/\s*\((?:комментарий|инструкция|пояснение)[^)]*\)/gi, "")
    .replace(/\s*\[(?:комментарий|инструкция|пояснение)[^\]]*\]/gi, "")
    .replace(/\s*[—–|]\s*(?:комментарий|инструкция|пояснение)\b.*$/i, "")
    .trim();
  const editorialDivider = withoutBrackets.match(/^(.{8,120}?):\s*(?:конкурент|раскрыть|добавить|использовать|сделать акцент|редакцион)/i);
  return (editorialDivider?.[1] || withoutBrackets).trim();
}

function normalizeStoredSemanticResult(value: unknown): SemanticResult | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Omit<Partial<SemanticResult>, "keywords"> & { keywords?: Array<Partial<SemanticKeyword> & { demand?: string }> };
  if (!Array.isArray(source.keywords) || !source.keywords.length) return null;
  const keywords = source.keywords.map((item, index) => ({
    id: typeof item.id === "string" && item.id ? item.id : `semantic-${index + 1}`,
    phrase: typeof item.phrase === "string" ? item.phrase : "",
    cluster: typeof item.cluster === "string" && item.cluster ? item.cluster : "Основная тема",
    intent: ["Информационный", "Коммерческий", "Транзакционный", "Смешанный", "Навигационный"].includes(item.intent || "")
      ? item.intent as SemanticKeyword["intent"]
      : "Смешанный",
    role: ["Основной", "Поддерживающий", "Вопрос", "Гео"].includes(item.role || "")
      ? item.role as SemanticKeyword["role"]
      : "Поддерживающий",
    relation: ["Ядро", "Синоним", "Проблема", "Решение", "Смежный", "Вопрос", "Бренд", "Гео"].includes(item.relation || "")
      ? item.relation as SemanticKeyword["relation"]
      : item.role === "Основной" ? "Ядро" : item.role === "Вопрос" ? "Вопрос" : item.role === "Гео" ? "Гео" : "Синоним",
    breadth: ["Широкий", "Средний", "Узкий"].includes(item.breadth || "")
      ? item.breadth as SemanticKeyword["breadth"]
      : item.demand === "Низкий" || item.demand === "Нишевый" ? "Узкий" : "Средний",
    recommended: Boolean(item.recommended),
    note: typeof item.note === "string" ? item.note : "",
  })).filter((item) => item.phrase.trim());
  if (!keywords.length) return null;
  return {
    primaryQuery: typeof source.primaryQuery === "string" ? source.primaryQuery : "",
    intent: {
      label: typeof source.intent?.label === "string" ? source.intent.label : "",
      stage: typeof source.intent?.stage === "string" ? source.intent.stage : "",
      summary: typeof source.intent?.summary === "string" ? source.intent.summary : "",
    },
    suggestedTopic: typeof source.suggestedTopic === "string" ? source.suggestedTopic : "",
    recommendedLength: typeof source.recommendedLength === "number" ? source.recommendedLength : 1200,
    dataNote: typeof source.dataNote === "string" ? source.dataNote : "",
    keywords,
  };
}

function normalizeContentPlanItem(value: Partial<ContentPlanItem>, index: number): ContentPlanItem {
  const title = cleanContentPlanTitle(typeof value.title === "string" ? value.title : "");
  return {
    id: typeof value.id === "string" && value.id ? value.id : `plan-${index + 1}`,
    title,
    cluster: typeof value.cluster === "string" && value.cluster ? value.cluster : "Основная тема",
    format: ["SEO‑статья", "Экспертный разбор", "FAQ", "Сравнение", "Кейс", "Посадочная страница", "Рекламный текст", "Пост"].includes(value.format || "")
      ? value.format as ContentPlanItem["format"]
      : "SEO‑статья",
    intent: ["Информационный", "Коммерческий", "Транзакционный", "Смешанный", "Навигационный"].includes(value.intent || "")
      ? value.intent as ContentPlanItem["intent"]
      : "Смешанный",
    stage: ["Знакомство", "Выбор", "Решение", "Удержание"].includes(value.stage || "")
      ? value.stage as ContentPlanItem["stage"]
      : "Выбор",
    priority: ["Высокий", "Средний", "Дополнительный"].includes(value.priority || "")
      ? value.priority as ContentPlanItem["priority"]
      : "Средний",
    angle: typeof value.angle === "string" && value.angle ? value.angle : "Предметный ракурс по исходной теме",
    objective: typeof value.objective === "string" && value.objective ? value.objective : "Закрыть задачу аудитории по теме материала",
    primaryKeyword: typeof value.primaryKeyword === "string" ? value.primaryKeyword : "",
    lsi: Array.isArray(value.lsi) ? value.lsi.filter((item): item is string => typeof item === "string") : [],
    audience: typeof value.audience === "string" ? value.audience : "",
    metaTitle: cleanContentPlanTitle(typeof value.metaTitle === "string" ? value.metaTitle : title),
    metaDescription: typeof value.metaDescription === "string" ? value.metaDescription : "",
    structure: Array.isArray(value.structure) ? value.structure.filter((item): item is string => typeof item === "string") : [],
    cta: typeof value.cta === "string" ? value.cta : "",
    evidenceNeeded: Array.isArray(value.evidenceNeeded) ? value.evidenceNeeded.filter((item): item is string => typeof item === "string") : [],
    sources: Array.isArray(value.sources) ? value.sources.filter((item): item is string => typeof item === "string") : [],
    status: value.status === "В работе" || value.status === "Готово" ? value.status : "Запланировано",
  };
}

function normalizeStoredContentPlanResult(value: unknown): ContentPlanResult | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<ContentPlanResult>;
  if (!Array.isArray(source.items) || !source.items.length) return null;
  const items = source.items.map((item, index) => normalizeContentPlanItem(item, index)).filter((item) => item.title);
  if (!items.length) return null;
  return {
    query: typeof source.query === "string" ? source.query : "",
    items,
    clusters: Array.isArray(source.clusters) ? source.clusters.filter((item): item is string => typeof item === "string") : [...new Set(items.map((item) => item.cluster))],
    dataNote: typeof source.dataNote === "string" ? source.dataNote : "",
  };
}

function normalizeWorkspaceBrand(value: unknown): WorkspaceBrand | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id : "";
  if (!id) return null;
  const rawProfile = source.profile && typeof source.profile === "object" ? source.profile as Partial<BrandProfile> : {};
  const profile = migrateStoredBrand({ ...defaultBrand, ...rawProfile });
  return {
    id,
    name: typeof source.name === "string" ? source.name : profile.name,
    website: typeof source.website === "string" ? source.website : profile.website,
    profile,
    workspace: source.workspace && typeof source.workspace === "object" ? source.workspace as BrandWorkspaceSnapshot : {},
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
  };
}

// A connection killed mid-response (proxy/gateway timeout, network drop)
// makes response.json() throw, which used to skip past the "не удалось…"
// fallback message entirely and surface a blank error line. Parsing safely
// here means callers always get *something* to show, even on a timeout.
async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function archiveDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function nameInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((item) => item[0]?.toLocaleUpperCase("ru-RU") || "").join("") || "К").slice(0, 2);
}

function readabilityDiagnostics(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const sentences = value.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  const paragraphs = value.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (!words.length) return { score: 0, sentenceLength: 0, paragraphLength: 0 };
  const sentenceLength = words.length / Math.max(sentences.length, 1);
  const paragraphLength = words.length / Math.max(paragraphs.length, 1);
  const sentencePenalty = Math.min(34, Math.abs(sentenceLength - 14) * 1.55);
  const paragraphPenalty = paragraphLength > 95 ? Math.min(18, (paragraphLength - 95) / 5) : 0;
  const score = Math.max(45, Math.min(98, Math.round(96 - sentencePenalty - paragraphPenalty)));
  return { score, sentenceLength, paragraphLength };
}

function Icon({ name }: { name: "arrow" | "spark" | "check" | "copy" | "edit" | "erase" }) {
  const paths = {
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    spark: <><path d="m12 2 1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2Z"/><path d="m5 16 .7 2.3L8 19l-2.3.7L5 22l-.7-2.3L2 19l2.3-.7L5 16Z"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
    erase: <><path d="m18 6-12 12"/><path d="m6 6 12 12"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

// Custom dropdown matching the brand-switcher's visual language (trigger +
// floating list, checkmark on the active item) instead of a native <select>.
// The list portals to document.body and positions itself via a measured
// rect — several of this component's homes (e.g. the generator's brief
// panel) have overflow:hidden ancestors for their own rounded-corner/
// background clipping, which would otherwise cut the open list off.
function ModuleSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Reposition on scroll instead of closing — the list is portaled and
    // position:fixed, so it needs to track the trigger if the page scrolls.
    // Scrolling *inside* the option list itself (a capture-phase scroll
    // event bubbling up from listRef) must not close the menu — that used
    // to make picking a style/length impossible to scroll to.
    const repositionOnScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", repositionOnScroll, true);
    window.addEventListener("resize", repositionOnScroll);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", repositionOnScroll, true);
      window.removeEventListener("resize", repositionOnScroll);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    }
    setOpen((current) => !current);
  }

  const activeOption = options.find((item) => item.value === value);

  return <div className={`field module-select ${open ? "is-open" : ""}`} ref={containerRef}>
    <span>{label}</span>
    <button type="button" ref={triggerRef} className="module-select-trigger" onClick={toggleOpen} aria-haspopup="listbox" aria-expanded={open}>
      <b>{activeOption?.label || value}</b>
      <em>⌄</em>
    </button>
    {open && menuRect && createPortal(
      <div className="module-select-list" role="listbox" aria-label={label} ref={listRef} style={{ position: "fixed", top: menuRect.top, left: menuRect.left, width: menuRect.width }}>
        {options.map((item) => <button type="button" role="option" aria-selected={item.value === value} className={item.value === value ? "active" : ""} onClick={() => { onChange(item.value); setOpen(false); }} key={item.value}>
          <span>{item.label}</span><em>{item.value === value ? "✓" : ""}</em>
        </button>)}
      </div>,
      document.body,
    )}
  </div>;
}

function CoverageIcon({ coverage }: { coverage: CompetitorCoverage }) {
  const paths = {
    strong: <path d="m7.5 12.2 2.8 2.8 6.4-7"/>,
    partial: <><path d="M12 7a5 5 0 1 1-5 5"/><path d="M12 7v5H7"/></>,
    missing: <path d="M8.2 12h7.6"/>,
    unknown: <><path d="M9.7 9.4a2.55 2.55 0 0 1 4.85 1.1c0 1.7-2.55 1.9-2.55 3.25"/><path d="M12 17h.01"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6" opacity=".28"/>{paths[coverage]}</svg>;
}

function Brand() {
  return <span className="brand"><i>К</i><b>КЛИО</b><small>Цифровая редакция</small></span>;
}

function MetricNumber({ value, replay }: { value: number; replay: number }) {
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
  return <span className="metric-number" key={`${replay}-${safeValue}`}>{safeValue}</span>;
}

type AutoTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  value: string;
};

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  const safetySpace = textarea.classList.contains("result-body") ? 28 : textarea.classList.contains("result-title") ? 8 : 3;
  textarea.style.height = "auto";
  const computed = window.getComputedStyle(textarea);
  const minHeight = Number.parseFloat(computed.minHeight) || 0;
  const maxHeight = Number.parseFloat(computed.maxHeight);
  const contentHeight = Math.ceil(textarea.scrollHeight + safetySpace);
  const nextHeight = Number.isFinite(maxHeight)
    ? Math.min(Math.max(contentHeight, minHeight), maxHeight)
    : Math.max(contentHeight, minHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = Number.isFinite(maxHeight) && contentHeight > maxHeight ? "auto" : "hidden";
}

function AutoTextarea({ value, className, onInput, ...props }: AutoTextareaProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    resizeTextarea(fieldRef.current);
    const frame = window.requestAnimationFrame(() => resizeTextarea(fieldRef.current));
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) resizeTextarea(fieldRef.current);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [className, value]);

  useEffect(() => {
    const resize = () => resizeTextarea(fieldRef.current);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return <textarea
    {...props}
    ref={fieldRef}
    className={className}
    value={value}
    data-autosize="true"
    // Chrome/Edge restore typed field values after a plain page reload
    // (separate from autofill/localStorage — the browser caches and
    // replays them itself, dispatching a real input event React then
    // treats as user input). autoComplete="off" is what stops that, so a
    // reload actually starts clean instead of resurrecting the last
    // session's topic/keywords/draft.
    autoComplete="off"
    onInput={(event) => {
      resizeTextarea(event.currentTarget);
      onInput?.(event);
    }}
  />;
}

function MarqueeGroup({ hidden = false }: { hidden?: boolean }) {
  return <div className="marquee-group" aria-hidden={hidden || undefined}>{marqueeItems.map((item) => <span key={item}><b>{item}</b><i>✦</i></span>)}</div>;
}

export default function TextoraExperience({ workspace = false }: { workspace?: boolean }) {
  const [intro, setIntro] = useState(true);
  const [format, setFormat] = useState<Format>("seo");
  const [topic, setTopic] = useState(workspace ? "" : "Как выбрать санаторий для восстановления");
  const [keywords, setKeywords] = useState(workspace ? "" : "санаторий для восстановления, лечение в Карелии, лечебные программы");
  const [tone, setTone] = useState("Экспертный");
  const [length, setLength] = useState(1200);
  const [customLength, setCustomLength] = useState(false);
  const [accent, setAccent] = useState("");
  const [brand, setBrand] = useState<BrandProfile>(defaultBrand);
  const [useBrand, setUseBrand] = useState(true);
  const [brandOpen, setBrandOpen] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [brandTab, setBrandTab] = useState<BrandTab>("foundation");
  const [profileMode, setProfileMode] = useState<ProfileMode>("quick");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [semanticGeo, setSemanticGeo] = useState<SemanticGeo>(defaultSemanticGeo);
  const [semanticGeoOpen, setSemanticGeoOpen] = useState(false);
  const [semanticGeoSearch, setSemanticGeoSearch] = useState("");
  const [openGeoDistricts, setOpenGeoDistricts] = useState<string[]>(["Северо-Западный федеральный округ"]);
  const [openGeoRegions, setOpenGeoRegions] = useState<string[]>(["Республика Карелия"]);
  const [semanticResult, setSemanticResult] = useState<SemanticResult>(defaultSemanticResult);
  const [semanticMode, setSemanticMode] = useState<SemanticMode>("idle");
  const [aiConnection, setAiConnection] = useState<AiConnection>("checking");
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [semanticArticleBusy, setSemanticArticleBusy] = useState(false);
  const [semanticError, setSemanticError] = useState("");
  const [semanticNeedsRefresh, setSemanticNeedsRefresh] = useState(true);
  const [activeSemanticCluster, setActiveSemanticCluster] = useState("Все группы");
  const [selectedSemanticIds, setSelectedSemanticIds] = useState<string[]>(
    defaultSemanticResult.keywords.filter((item) => item.recommended).map((item) => item.id),
  );
  const [competitorQuery, setCompetitorQuery] = useState("");
  const [competitorFocusSource, setCompetitorFocusSource] = useState<CompetitorFocusSource>("manual");
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>(defaultCompetitors);
  const [competitorComment, setCompetitorComment] = useState("");
  const [competitorResult, setCompetitorResult] = useState<CompetitorResult>(workspace ? emptyCompetitorResult : defaultCompetitorResult);
  const [competitorMode, setCompetitorMode] = useState<CompetitorMode>("example");
  const [competitorBusy, setCompetitorBusy] = useState(false);
  const [competitorDiscoveryBusy, setCompetitorDiscoveryBusy] = useState(false);
  const [competitorDiscoveryNote, setCompetitorDiscoveryNote] = useState("");
  const [competitorError, setCompetitorError] = useState("");
  const [competitorNeedsRefresh, setCompetitorNeedsRefresh] = useState(false);
  const [competitorOpen, setCompetitorOpen] = useState(false);
  const [semanticOpen, setSemanticOpen] = useState(false);
  const [contentPlanOpen, setContentPlanOpen] = useState(false);
  const [adaptationOpen, setAdaptationOpen] = useState(false);
  const [generatorAdvanced, setGeneratorAdvanced] = useState(true);
  const [generatorMode, setGeneratorMode] = useState<"quick" | "advanced">("quick");
  const [quickPrompt, setQuickPrompt] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [generatorUseBrand, setGeneratorUseBrand] = useState(true);
  const [generatorUseSemantics, setGeneratorUseSemantics] = useState(true);
  const [generatorUseCompetitors, setGeneratorUseCompetitors] = useState(true);
  const [selectedCompetitorTopicIds, setSelectedCompetitorTopicIds] = useState<string[]>(
    workspace ? [] : defaultCompetitorResult.topics.filter((item) => item.recommended).map((item) => item.id),
  );
  const [contentPlanQuery, setContentPlanQuery] = useState("");
  const [contentPlanGoal, setContentPlanGoal] = useState<ContentPlanGoal>("mixed");
  const [contentPlanCount, setContentPlanCount] = useState(25);
  const [contentPlanResult, setContentPlanResult] = useState<ContentPlanResult>(emptyContentPlanResult);
  const [contentPlanMode, setContentPlanMode] = useState<ContentPlanMode>("idle");
  const [contentPlanBusy, setContentPlanBusy] = useState(false);
  const [contentPlanError, setContentPlanError] = useState("");
  const [expandedPlanItem, setExpandedPlanItem] = useState<string | null>(null);
  const [contentPlanNeedsRefresh, setContentPlanNeedsRefresh] = useState(true);
  const [selectedPlanItemIds, setSelectedPlanItemIds] = useState<string[]>([]);
  const [planReplacementOpen, setPlanReplacementOpen] = useState(false);
  const [planReplacementPreference, setPlanReplacementPreference] = useState("Другой ракурс");
  const [planReplacementComment, setPlanReplacementComment] = useState("");
  const [planReplacementBusy, setPlanReplacementBusy] = useState(false);
  const [planReplacementError, setPlanReplacementError] = useState("");
  const [planReplacements, setPlanReplacements] = useState<ContentPlanReplacement[]>([]);
  const [title, setTitle] = useState(workspace ? "Здесь появится заголовок материала" : sample.seo.title);
  const [body, setBody] = useState(workspace ? "Результат появится после генерации. Начните с темы и ключевых слов — дополнительные инструменты можно открыть позже." : sample.seo.body);
  const [metaTitle, setMetaTitle] = useState(workspace ? "" : sample.seo.title.slice(0, 70));
  const [metaDescription, setMetaDescription] = useState(workspace ? "" : "Как выбрать санаторий для восстановления: медицинский профиль, лечебные факторы, программа и документы для поездки.");
  const [editorNote, setEditorNote] = useState(workspace ? "Служебный комментарий появится после генерации и не попадёт в скопированный текст." : "Материал подготовлен в стиле «экспертный» с целевым объёмом 1 200 слов. Ключевые темы: санаторий для восстановления, лечение в Карелии, лечебные программы.");
  const [busy, setBusy] = useState(false);
  const [busyStep, setBusyStep] = useState(0);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("example");
  const [generationCoverage, setGenerationCoverage] = useState<GenerationCoverage | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [toast, setToast] = useState("");
  const [annual, setAnnual] = useState(false);
  const [metricsVisible, setMetricsVisible] = useState(workspace);
  const [metricsReplay, setMetricsReplay] = useState(0);
  const [adaptationSource, setAdaptationSource] = useState(workspace ? "" : defaultAdaptationSource);
  const [adaptationGoal, setAdaptationGoal] = useState<AdaptationGoal>("proofread");
  const [adaptationTone, setAdaptationTone] = useState("Экспертный");
  const [adaptationKeywords, setAdaptationKeywords] = useState(workspace ? "" : "санаторий в Карелии, санаторий для восстановления");
  const [adaptationInstructions, setAdaptationInstructions] = useState(workspace ? "" : "Сохранить медицинскую корректность и спокойную экспертную интонацию.");
  const [adaptationResult, setAdaptationResult] = useState<AdaptedMaterial | null>(null);
  const [adaptationBusy, setAdaptationBusy] = useState(false);
  const [adaptationMode, setAdaptationMode] = useState<AdaptationMode>("example");
  const [adaptationError, setAdaptationError] = useState("");
  const [workspaceAccount, setWorkspaceAccount] = useState<WorkspaceAccount>({
    planId: "start",
    planName: PLAN_RULES.start.name,
    generationsUsed: 0,
    generationLimit: PLAN_RULES.start.generationLimit,
    generationsRemaining: PLAN_RULES.start.generationLimit,
    researchUsed: 0,
    researchLimit: PLAN_RULES.start.researchLimit,
    researchRemaining: PLAN_RULES.start.researchLimit,
    editorActionsUsed: 0,
    editorActionLimit: PLAN_RULES.start.editorActionLimit,
    editorActionsRemaining: PLAN_RULES.start.editorActionLimit,
    brandCount: 0,
    brandLimit: PLAN_RULES.start.brandLimit,
    seatLimit: 1,
    period: "",
  });
  const [workspaceBrands, setWorkspaceBrands] = useState<WorkspaceBrand[]>([]);
  const [activeBrandId, setActiveBrandId] = useState("");
  const [workspaceHistory, setWorkspaceHistory] = useState<GenerationArchiveItem[]>([]);
  const [workspaceMaterials, setWorkspaceMaterials] = useState<SavedWorkspaceMaterial[]>([]);
  const [workspaceUserName, setWorkspaceUserName] = useState("Сергей");
  const [workspaceReady, setWorkspaceReady] = useState(!workspace);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceDataError, setWorkspaceDataError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [materialsFilter, setMaterialsFilter] = useState<MaterialsFilter>("all");
  const [materialsDateRange, setMaterialsDateRange] = useState<MaterialsDateRange>("all");
  const [moduleMaterialSources, setModuleMaterialSources] = useState<Partial<Record<SavedMaterialType, string>>>({});
  const [materialSavingType, setMaterialSavingType] = useState<SavedMaterialType | null>(null);
  const [archiveEditorItem, setArchiveEditorItem] = useState<GenerationArchiveItem | null>(null);
  const [archiveEditorOriginal, setArchiveEditorOriginal] = useState<GenerationArchiveItem | null>(null);
  const [archiveEditorSaving, setArchiveEditorSaving] = useState(false);
  const [archiveEditorBusy, setArchiveEditorBusy] = useState(false);
  const [archiveEditorError, setArchiveEditorError] = useState("");
  const [archiveEditorChanges, setArchiveEditorChanges] = useState<string[]>([]);
  const [archiveEditorTone, setArchiveEditorTone] = useState("Экспертный");
  const [archiveTransformGoal, setArchiveTransformGoal] = useState<AdaptationGoal>("proofread");
  const [brandCreatorOpen, setBrandCreatorOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [brandSwitchBusy, setBrandSwitchBusy] = useState(false);
  const metricsRef = useRef<HTMLDivElement>(null);
  const geoPickerRef = useRef<HTMLDivElement>(null);
  const brandPickerRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const words = useMemo(() => body.trim().split(/\s+/).filter(Boolean).length, [body]);
  const keyList = useMemo(() => keywords.split(",").map((item) => item.trim()).filter(Boolean), [keywords]);
  const quality = useMemo(() => {
    const fullText = `${title} ${body}`;
    const keysFound = keyList.filter((key) => containsKeyword(fullText, key)).length;
    const coverage = keyList.length ? keysFound / keyList.length : 0;
    const primaryInTitle = keyList[0] ? containsKeyword(title, keyList[0]) : false;
    const lengthProgress = Math.min(words / Math.max(length * 0.72, 1), 1);
    const structureCount = body.split(/\n\s*\n/).filter(Boolean).length;
    const structure = Math.min(structureCount / 5, 1);
    // Keyword coverage and "primary keyword in title" only mean anything
    // when keywords were actually set — otherwise these two factors (52 of
    // 100 points) were structurally impossible to earn, capping every
    // keyword-free result (e.g. the "Новичок" quick-generate flow, which
    // never sets keywords) at 48 regardless of how good the text was.
    // Score purely on what's actually measurable when there are none.
    const hasKeywords = keyList.length > 0;
    const seo = hasKeywords
      ? Math.min(100, Math.round(28 + coverage * 37 + (primaryInTitle ? 15 : 0) + lengthProgress * 12 + structure * 8))
      : Math.min(100, Math.round(40 + lengthProgress * 30 + structure * 30));
    const readabilityInfo = readabilityDiagnostics(body);

    // Concrete, actionable notes instead of a bare "есть точки роста" —
    // each one names exactly what to change and, where relevant, by how
    // much. Capped so the card stays a quick glance, not a checklist wall.
    const seoTips: string[] = [];
    if (hasKeywords && keyList[0] && !primaryInTitle) seoTips.push(`Добавьте основной запрос «${keyList[0]}» в заголовок`);
    if (hasKeywords && keysFound < keyList.length) seoTips.push(`Используйте ещё ${keyList.length - keysFound} из ${keyList.length} ключевых фраз в тексте`);
    if (structureCount < 4) seoTips.push("Добавьте ещё один-два смысловых раздела с подзаголовком");
    if (!hasKeywords) seoTips.push("Ключевые слова не заданы — добавьте их в брифе для более точной SEO‑оценки");

    const readabilityTips: string[] = [];
    if (readabilityInfo.sentenceLength > 20) readabilityTips.push("Сократите самые длинные предложения");
    else if (readabilityInfo.sentenceLength > 0 && readabilityInfo.sentenceLength < 7) readabilityTips.push("Часть коротких предложений можно объединить");
    if (readabilityInfo.paragraphLength > 95) readabilityTips.push("Разбейте длинные абзацы на более короткие");

    return { seo, readability: readabilityInfo.score, keysFound, seoTips: seoTips.slice(0, 2), readabilityTips: readabilityTips.slice(0, 1) };
  }, [body, keyList, length, title, words]);
  const foundationReady = Boolean(
    brand.name.trim()
    && brand.description.trim()
    && brand.positioning.trim()
    && brand.audience.trim()
    && brand.advantages.trim(),
  );
  const voiceRecommendations = useMemo(() => buildVoiceRecommendations(brand), [brand]);
  const formatRecommendations = useMemo(
    () => buildFormatRecommendations(),
    [],
  );
  const effectiveBrand = useMemo(() => {
    if (profileMode !== "quick" || !foundationReady) return brand;
    return { ...brand, ...voiceRecommendations, ...formatRecommendations };
  }, [brand, formatRecommendations, foundationReady, profileMode, voiceRecommendations]);
  const brandChecklist = useMemo(() => [
    {
      label: "Основа",
      detail: "название, описание и позиционирование",
      complete: Boolean(effectiveBrand.name.trim() && effectiveBrand.description.trim() && effectiveBrand.positioning.trim()),
    },
    {
      label: "Аудитория и факты",
      detail: "кому говорим и чем подтверждаем",
      complete: Boolean(effectiveBrand.audience.trim() && effectiveBrand.advantages.trim()),
    },
    {
      label: "Голос и безопасность",
      detail: "интонация, ограничения и стоп-слова",
      complete: Boolean(effectiveBrand.voice.trim() && effectiveBrand.restrictions.trim() && effectiveBrand.prohibited.trim()),
    },
    {
      label: "Форматы",
      detail: "правила для четырёх типов материалов",
      complete: Boolean(effectiveBrand.seoRules.trim() && effectiveBrand.socialRules.trim() && effectiveBrand.adsRules.trim() && effectiveBrand.landingRules.trim()),
    },
  ], [effectiveBrand]);
  const brandScore = Math.round((brandChecklist.filter((item) => item.complete).length / brandChecklist.length) * 100);
  const semanticClusters = useMemo(() => [
    "Все группы",
    ...Array.from(new Set(semanticResult.keywords.map((item) => item.cluster))),
  ], [semanticResult]);
  const visibleSemanticKeywords = useMemo(
    () => activeSemanticCluster === "Все группы"
      ? semanticResult.keywords
      : semanticResult.keywords.filter((item) => item.cluster === activeSemanticCluster),
    [activeSemanticCluster, semanticResult],
  );
  const selectedSemanticKeywords = useMemo(
    () => semanticResult.keywords.filter((item) => selectedSemanticIds.includes(item.id)),
    [selectedSemanticIds, semanticResult],
  );
  const selectedClusters = useMemo(
    () => new Set(selectedSemanticKeywords.map((item) => item.cluster)).size,
    [selectedSemanticKeywords],
  );
  const semanticAnalysisReady = semanticMode !== "idle" && !semanticNeedsRefresh;
  const selectedGeoCityIds = useMemo(() => new Set(semanticGeo.cityIds), [semanticGeo]);
  const selectedGeoScopes = useMemo(() => semanticGeoScopes(semanticGeo), [semanticGeo]);
  const semanticRegion = useMemo(() => {
    return selectedGeoScopes.length ? selectedGeoScopes.map((scope) => scope.label).join(", ") : "Россия";
  }, [selectedGeoScopes]);
  const semanticGeoSummary = useMemo(() => {
    if (!selectedGeoScopes.length) return "Вся Россия";
    const visible = selectedGeoScopes.slice(0, 2).map((scope) => scope.label);
    return selectedGeoScopes.length > 2
      ? `${visible.join(", ")} и ещё ${selectedGeoScopes.length - 2}`
      : visible.join(", ");
  }, [selectedGeoScopes]);
  const visibleGeoTree = useMemo(() => {
    const query = normalizeForSearch(semanticGeoSearch);
    if (!query) return russianGeoTree;
    return russianGeoTree.flatMap((district) => {
      if (normalizeForSearch(district.name).includes(query)) return [district];
      const regions = district.regions.flatMap((region) => {
        if (normalizeForSearch(region.name).includes(query)) return [region];
        const cities = region.cities.filter((city) => normalizeForSearch(city).includes(query));
        return cities.length ? [{ ...region, cities }] : [];
      });
      return regions.length ? [{ ...district, regions }] : [];
    });
  }, [semanticGeoSearch]);
  const adaptationSourceWords = useMemo(
    () => adaptationSource.trim().split(/\s+/).filter(Boolean).length,
    [adaptationSource],
  );
  const selectedCompetitorTopics = useMemo(
    () => competitorResult.topics.filter((item) => selectedCompetitorTopicIds.includes(item.id)),
    [competitorResult, selectedCompetitorTopicIds],
  );
  const generatorBrandReady = useBrand && Boolean(effectiveBrand.name.trim());
  const generatorSemanticsReady = semanticAnalysisReady && selectedSemanticKeywords.length > 0;
  const generatorCompetitorsReady = competitorMode !== "example" && !competitorNeedsRefresh && selectedCompetitorTopics.length > 0;
  const contentPlanProgress = useMemo(() => ({
    ready: contentPlanResult.items.filter((item) => item.status === "Готово").length,
    working: contentPlanResult.items.filter((item) => item.status === "В работе").length,
  }), [contentPlanResult.items]);
  const loadedCompetitorSources = useMemo(
    () => competitorResult.competitors.filter((item) => item.status === "loaded" || item.status === "example").length,
    [competitorResult],
  );
  const validCompetitorEntries = useMemo(
    () => competitors.filter((item) => /^https?:\/\//i.test(item.url.trim())).length,
    [competitors],
  );
  const activeFormatPlan = FORMAT_PLANS[format];
  const activeAdaptationPlan = ADAPTATION_PLANS[adaptationGoal];
  const activeArchivePlan = ADAPTATION_PLANS[archiveTransformGoal];
  const workspaceSnapshot = useMemo<BrandWorkspaceSnapshot>(() => ({
    useBrand,
    profileMode,
    semantics: {
      query: semanticQuery,
      geo: semanticGeo,
      result: semanticResult,
      selectedIds: selectedSemanticIds,
      mode: semanticMode,
      needsRefresh: semanticNeedsRefresh,
    },
    competitors: {
      query: competitorQuery,
      focusSource: competitorFocusSource,
      entries: competitors,
      comment: competitorComment,
      result: competitorResult,
      selectedIds: selectedCompetitorTopicIds,
      mode: competitorMode,
      needsRefresh: competitorNeedsRefresh,
    },
    contentPlan: {
      query: contentPlanQuery,
      count: contentPlanCount,
      result: contentPlanResult,
      mode: contentPlanMode,
      needsRefresh: contentPlanNeedsRefresh,
    },
    // The generator's brief/result is deliberately NOT part of the saved
    // snapshot (see applyWorkspaceBrand's matching reset below) — unlike
    // semantics/competitors/content-plan/adaptation, which are ongoing
    // setup work worth keeping, a generator draft left over from an
    // earlier topic silently reappearing on the next visit or brand
    // switch was creating confusing "mixed" briefs (reported by the site
    // owner: an old topic bleeding into an unrelated new one).
    adaptation: {
      source: adaptationSource,
      goal: adaptationGoal,
      tone: adaptationTone,
      keywords: adaptationKeywords,
      instructions: adaptationInstructions,
      result: adaptationResult,
      mode: adaptationMode,
    },
  }), [
    adaptationGoal, adaptationInstructions, adaptationKeywords, adaptationMode, adaptationResult, adaptationSource, adaptationTone,
    competitorComment, competitorFocusSource, competitorMode, competitorNeedsRefresh, competitorQuery, competitorResult,
    competitors, contentPlanCount, contentPlanMode, contentPlanNeedsRefresh, contentPlanQuery, contentPlanResult,
    profileMode,
    selectedCompetitorTopicIds, selectedSemanticIds, semanticGeo, semanticMode, semanticNeedsRefresh, semanticQuery, semanticResult,
    useBrand,
  ]);
  const workspaceSnapshotJson = useMemo(() => JSON.stringify(workspaceSnapshot), [workspaceSnapshot]);
  const activeWorkspaceBrand = useMemo(
    () => workspaceBrands.find((item) => item.id === activeBrandId) ?? null,
    [activeBrandId, workspaceBrands],
  );
  const activeBrandArticles = useMemo(
    () => workspaceHistory.filter((item) => item.brandId === activeBrandId),
    [activeBrandId, workspaceHistory],
  );
  const activeBrandSavedMaterials = useMemo(
    () => workspaceMaterials.filter((item) => item.brandId === activeBrandId),
    [activeBrandId, workspaceMaterials],
  );
  const materialsFilterOptions = useMemo(() => [
    { id: "all" as const, label: "Все материалы", count: activeBrandArticles.length + activeBrandSavedMaterials.length },
    { id: "article" as const, label: "Статьи и тексты", count: activeBrandArticles.length },
    { id: "content_plan" as const, label: "Контент‑планы", count: activeBrandSavedMaterials.filter((item) => item.type === "content_plan").length },
    { id: "semantics" as const, label: "Семантика", count: activeBrandSavedMaterials.filter((item) => item.type === "semantics").length },
    { id: "competitors" as const, label: "Анализ конкурентов", count: activeBrandSavedMaterials.filter((item) => item.type === "competitors").length },
  ], [activeBrandArticles, activeBrandSavedMaterials]);
  const visibleBrandArticles = (materialsFilter === "all" || materialsFilter === "article" ? activeBrandArticles : [])
    .filter((item) => isWithinMaterialsDateRange(item.createdAt, materialsDateRange));
  const visibleBrandSavedMaterials = (materialsFilter === "all"
    ? activeBrandSavedMaterials
    : materialsFilter === "article"
      ? []
      : activeBrandSavedMaterials.filter((item) => item.type === materialsFilter))
    .filter((item) => isWithinMaterialsDateRange(item.createdAt, materialsDateRange));
  const activeMaterialCount = activeBrandArticles.length + activeBrandSavedMaterials.length;
  const generationProgress = Math.min(100, Math.round((workspaceAccount.generationsUsed / Math.max(workspaceAccount.generationLimit, 1)) * 100));
  const researchProgress = Math.min(100, Math.round((workspaceAccount.researchUsed / Math.max(workspaceAccount.researchLimit, 1)) * 100));
  const editorProgress = Math.min(100, Math.round((workspaceAccount.editorActionsUsed / Math.max(workspaceAccount.editorActionLimit, 1)) * 100));
  const archiveEditorDirty = Boolean(archiveEditorItem && archiveEditorOriginal && [
    archiveEditorItem.title !== archiveEditorOriginal.title,
    archiveEditorItem.body !== archiveEditorOriginal.body,
    archiveEditorItem.metaTitle !== archiveEditorOriginal.metaTitle,
    archiveEditorItem.metaDescription !== archiveEditorOriginal.metaDescription,
    archiveEditorItem.editorialComment !== archiveEditorOriginal.editorialComment,
    archiveEditorTone !== (archiveEditorOriginal.tone || "Экспертный"),
  ].some(Boolean));

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), 3200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai-status", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI status unavailable");
        return response.json() as Promise<{ connected?: boolean }>;
      })
      .then((status) => {
        if (cancelled) return;
        setAiConnection(status.connected ? "connected" : "disconnected");
      })
      .catch(() => {
        if (!cancelled) setAiConnection("disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;

    const loadWorkspace = async () => {
      setWorkspaceReady(false);
      setWorkspaceDataError("");
      try {
        const response = await fetch("/api/workspace", { cache: "no-store", headers: { Accept: "application/json" } });
        if (response.status === 401) {
          window.location.assign("/login?return_to=%2Fworkspace");
          return;
        }
        const payload = await safeJson(response) as {
          error?: string;
          user?: { displayName?: string };
          account?: WorkspaceAccount;
          brands?: unknown[];
          history?: GenerationArchiveItem[];
          materials?: SavedWorkspaceMaterial[];
        };
        if (!response.ok || !payload.account) throw new Error(payload.error || "Не удалось загрузить кабинет.");
        let records = (payload.brands ?? []).map(normalizeWorkspaceBrand).filter((item): item is WorkspaceBrand => Boolean(item));
        let account = payload.account;

        if (!records.length) {
          const createResponse = await fetch("/api/workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create_brand", profile: defaultBrand, workspace: {} }),
          });
          const createdPayload = await createResponse.json() as { error?: string; brand?: unknown; account?: WorkspaceAccount };
          const created = normalizeWorkspaceBrand(createdPayload.brand);
          if (!createResponse.ok || !created) throw new Error(createdPayload.error || "Не удалось создать первый профиль бренда.");
          records = [created];
          account = createdPayload.account ?? account;
        }

        if (cancelled) return;
        setWorkspaceUserName(payload.user?.displayName || "Пользователь");
        setWorkspaceAccount(account);
        setWorkspaceBrands(records);
        setWorkspaceHistory(Array.isArray(payload.history) ? payload.history : []);
        setWorkspaceMaterials(Array.isArray(payload.materials) ? payload.materials : []);
        const remembered = window.localStorage.getItem("clio-active-brand-id-v1");
        const selected = records.find((item) => item.id === remembered) ?? records[0];
        applyWorkspaceBrand(selected);
      } catch (error) {
        if (cancelled) return;
        setWorkspaceDataError(error instanceof Error ? error.message : "Не удалось загрузить кабинет.");
        setWorkspaceReady(true);
      }
    };

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const signOutOfWorkspace = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/");
    }
  };

  useEffect(() => {
    if (workspace) return;
    let frame = 0;
    try {
      const saved = window.localStorage.getItem("clio-brand-profile-v1");
      if (saved) {
        const parsed = migrateStoredBrand({ ...defaultBrand, ...(JSON.parse(saved) as Partial<BrandProfile>) });
        frame = window.requestAnimationFrame(() => {
          setBrand(parsed);
          window.localStorage.setItem("clio-brand-profile-v1", JSON.stringify(parsed));
          setBrandSaved(true);
        });
      }
    } catch {
      window.localStorage.removeItem("clio-brand-profile-v1");
    }
    return () => window.cancelAnimationFrame(frame);
  }, [workspace]);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#brand-profile") setBrandOpen(true);
      if (window.location.hash === "#semantics") setSemanticOpen(true);
      if (window.location.hash === "#competitors") setCompetitorOpen(true);
      if (window.location.hash === "#content-plan") setContentPlanOpen(true);
      if (window.location.hash === "#adaptation") setAdaptationOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  useEffect(() => {
    if (workspace) return;
    let frame = 0;
    try {
      const saved = window.localStorage.getItem("clio-semantics-v1");
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        schemaVersion?: number;
        query?: string;
        region?: string;
        geo?: unknown;
        result?: SemanticResult;
        selectedIds?: string[];
        mode?: SemanticMode;
        needsRefresh?: boolean;
      };
      frame = window.requestAnimationFrame(() => {
        if (parsed.query) setSemanticQuery(parsed.query);
        if (parsed.geo) setSemanticGeo(normalizeStoredGeo(parsed.geo, parsed.region));
        else if (parsed.region && parsed.region !== "Россия") setSemanticGeo(normalizeStoredGeo(null, parsed.region));
        const storedResult = normalizeStoredSemanticResult(parsed.result);
        if (storedResult) setSemanticResult(storedResult);
        if (Array.isArray(parsed.selectedIds)) setSelectedSemanticIds(parsed.selectedIds);
        if (parsed.mode === "ai" && storedResult) setSemanticMode("ai");
        const queryMatches = Boolean(
          parsed.query
          && parsed.result?.primaryQuery
          && normalizeForSearch(parsed.query) === normalizeForSearch(parsed.result.primaryQuery),
        );
        setSemanticNeedsRefresh(parsed.schemaVersion !== 4 || parsed.mode !== "ai" || parsed.needsRefresh !== false || !queryMatches);
      });
    } catch {
      window.localStorage.removeItem("clio-semantics-v1");
    }
    return () => window.cancelAnimationFrame(frame);
  }, [workspace]);

  useEffect(() => {
    if (workspace) return;
    let frame = 0;
    try {
      const saved = window.localStorage.getItem("clio-competitors-v1");
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        query?: string;
        focusSource?: CompetitorFocusSource;
        competitors?: CompetitorEntry[];
        comment?: string;
        result?: CompetitorResult;
        selectedIds?: string[];
        mode?: CompetitorMode;
        needsRefresh?: boolean;
      };
      frame = window.requestAnimationFrame(() => {
        if (parsed.query) setCompetitorQuery(parsed.query);
        if (parsed.focusSource === "manual" || parsed.focusSource === "semantics" || parsed.focusSource === "brand") setCompetitorFocusSource(parsed.focusSource);
        if (Array.isArray(parsed.competitors) && parsed.competitors.length) setCompetitors(parsed.competitors.slice(0, 5));
        if (typeof parsed.comment === "string") setCompetitorComment(parsed.comment);
        if (parsed.result?.topics?.length && parsed.result?.competitors?.length) setCompetitorResult(parsed.result);
        if (Array.isArray(parsed.selectedIds)) setSelectedCompetitorTopicIds(parsed.selectedIds);
        if (parsed.mode === "demo" || parsed.mode === "ai") setCompetitorMode(parsed.mode);
        if (typeof parsed.needsRefresh === "boolean") setCompetitorNeedsRefresh(parsed.needsRefresh);
      });
    } catch {
      window.localStorage.removeItem("clio-competitors-v1");
    }
    return () => window.cancelAnimationFrame(frame);
  }, [workspace]);

  useEffect(() => {
    if (workspace) return;
    let frame = 0;
    try {
      const saved = window.localStorage.getItem("clio-content-plan-v1");
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        query?: string;
        goal?: ContentPlanGoal;
        count?: number;
        result?: ContentPlanResult;
        mode?: ContentPlanMode;
        needsRefresh?: boolean;
      };
      frame = window.requestAnimationFrame(() => {
        if (typeof parsed.query === "string") setContentPlanQuery(parsed.query);
        if (CONTENT_PLAN_GOALS.some((goal) => goal.id === parsed.goal)) setContentPlanGoal(parsed.goal as ContentPlanGoal);
        if (parsed.count === 10 || parsed.count === 15 || parsed.count === 25) setContentPlanCount(parsed.count);
        const storedResult = normalizeStoredContentPlanResult(parsed.result);
        if (storedResult && parsed.mode === "ai") setContentPlanResult(storedResult);
        if (parsed.mode === "ai" && storedResult) setContentPlanMode("ai");
        setContentPlanNeedsRefresh(parsed.mode !== "ai" || parsed.needsRefresh !== false);
      });
    } catch {
      window.localStorage.removeItem("clio-content-plan-v1");
    }
    return () => window.cancelAnimationFrame(frame);
  }, [workspace]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setBusyStep((value) => Math.min(value + 1, busySteps.length - 1)), 900);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!workspace || !workspaceReady || !activeBrandId || brandSwitchBusy) return;
    const timer = window.setTimeout(async () => {
      setWorkspaceSaving(true);
      try {
        const response = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_brand",
            brandId: activeBrandId,
            profile: effectiveBrand,
            workspace: JSON.parse(workspaceSnapshotJson),
          }),
        });
        const payload = await safeJson(response) as { error?: string; brand?: unknown; account?: WorkspaceAccount };
        if (!response.ok) throw new Error(payload.error || "Не удалось сохранить изменения.");
        const saved = normalizeWorkspaceBrand(payload.brand);
        if (saved) setWorkspaceBrands((current) => current.map((item) => item.id === saved.id ? saved : item));
        if (payload.account) setWorkspaceAccount(payload.account);
        setBrandSaved(true);
        setWorkspaceDataError("");
      } catch (error) {
        setWorkspaceDataError(error instanceof Error ? error.message : "Не удалось сохранить изменения.");
      } finally {
        setWorkspaceSaving(false);
      }
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [activeBrandId, brandSwitchBusy, effectiveBrand, workspace, workspaceReady, workspaceSnapshotJson]);

  useEffect(() => {
    if (!semanticGeoOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!geoPickerRef.current?.contains(event.target as Node)) setSemanticGeoOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSemanticGeoOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [semanticGeoOpen]);

  useEffect(() => {
    if (!brandMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!brandPickerRef.current?.contains(event.target as Node)) setBrandMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBrandMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [brandMenuOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!archiveEditorItem) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || archiveEditorBusy || archiveEditorSaving) return;
      if (archiveEditorDirty && !window.confirm("Закрыть редактор без сохранения изменений?")) return;
      setArchiveEditorItem(null);
      setArchiveEditorOriginal(null);
      setArchiveEditorChanges([]);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [archiveEditorBusy, archiveEditorDirty, archiveEditorItem, archiveEditorSaving]);

  useEffect(() => {
    if (workspace) return;
    const node = metricsRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setMetricsVisible(true);
    }, { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [workspace]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function copyPlainText(value: string, label: string) {
    if (!value.trim()) {
      showToast(`${label}: поле пока пустое`);
      return;
    }
    navigator.clipboard?.writeText(value);
    showToast(`${label} скопирован${label.endsWith("е") ? "о" : ""}`);
  }

  function applyWorkspaceBrand(record: WorkspaceBrand) {
    const snapshot = record.workspace ?? {};
    const semantics = snapshot.semantics ?? {};
    const competitorState = snapshot.competitors ?? {};
    const planState = snapshot.contentPlan ?? {};
    const adaptationState = snapshot.adaptation ?? {};
    setWorkspaceReady(false);
    setActiveBrandId(record.id);
    setMaterialsFilter("all");
    setModuleMaterialSources({});
    setSelectedPlanItemIds([]);
    setPlanReplacementOpen(false);
    setPlanReplacements([]);
    setPlanReplacementError("");
    window.localStorage.setItem("clio-active-brand-id-v1", record.id);
    setBrand(migrateStoredBrand({ ...defaultBrand, ...record.profile }));
    setBrandSaved(true);
    setUseBrand(snapshot.useBrand !== false);
    setProfileMode(snapshot.profileMode === "expert" ? "expert" : "quick");

    setSemanticQuery(semantics.query ?? "");
    setSemanticGeo(semantics.geo ? normalizeStoredGeo(semantics.geo) : defaultSemanticGeo);
    const storedSemanticResult = normalizeStoredSemanticResult(semantics.result);
    setSemanticResult(storedSemanticResult ?? defaultSemanticResult);
    setSelectedSemanticIds(Array.isArray(semantics.selectedIds) ? semantics.selectedIds : []);
    setSemanticMode(semantics.mode === "ai" && storedSemanticResult ? "ai" : "idle");
    setSemanticNeedsRefresh(semantics.mode !== "ai" || semantics.needsRefresh !== false);
    setSemanticError("");

    setCompetitorQuery(competitorState.query ?? "");
    setCompetitorFocusSource(competitorState.focusSource === "semantics" || competitorState.focusSource === "brand" ? competitorState.focusSource : "manual");
    setCompetitors(Array.isArray(competitorState.entries) && competitorState.entries.length ? competitorState.entries : defaultCompetitors);
    setCompetitorComment(competitorState.comment ?? "");
    setCompetitorResult(competitorState.result?.topics?.length ? competitorState.result : emptyCompetitorResult);
    setSelectedCompetitorTopicIds(Array.isArray(competitorState.selectedIds) ? competitorState.selectedIds : []);
    setCompetitorMode(competitorState.mode === "ai" || competitorState.mode === "demo" ? competitorState.mode : "example");
    setCompetitorNeedsRefresh(competitorState.needsRefresh !== false);
    setCompetitorError("");

    const storedPlan = normalizeStoredContentPlanResult(planState.result);
    setContentPlanQuery(planState.query ?? "");
    setContentPlanCount(planState.count === 10 || planState.count === 15 || planState.count === 25 ? planState.count : 25);
    setContentPlanResult(planState.mode === "ai" && storedPlan ? storedPlan : emptyContentPlanResult);
    setContentPlanMode(planState.mode === "ai" && storedPlan ? "ai" : "idle");
    setContentPlanNeedsRefresh(planState.mode !== "ai" || planState.needsRefresh !== false);
    setExpandedPlanItem(null);
    setContentPlanError("");

    // Generator brief/result is never restored from a saved snapshot — see
    // the comment on workspaceSnapshot above. Every load or brand switch
    // starts it exactly as empty as the "Начать заново" button leaves it,
    // on purpose: a previous topic/keywords/draft quietly reappearing was
    // the actual bug being fixed here, not a feature to preserve.
    setFormat("seo");
    setTopic("");
    setKeywords("");
    setTone("Экспертный");
    setLength(defaultLengthByFormat.seo);
    setCustomLength(false);
    setAccent("");
    setTitle("Здесь появится заголовок материала");
    setBody("Результат появится после генерации. Шаблонные ответы отключены: до подключения ИИ КЛИО не создаёт тестовый текст.");
    setMetaTitle("");
    setMetaDescription("");
    setEditorNote("Служебный комментарий появится после реальной AI‑генерации и не попадёт в скопированный текст.");
    setGenerationMode("example");
    setGenerationCoverage(null);
    setGeneratorUseBrand(true);
    setGeneratorUseSemantics(true);
    setGeneratorUseCompetitors(true);
    setQuickPrompt("");
    setQuickError("");
    setGenerationError("");

    setAdaptationSource(adaptationState.source ?? "");
    setAdaptationGoal(isAdaptationGoal(adaptationState.goal) ? adaptationState.goal : "proofread");
    setAdaptationTone(adaptationState.tone && styles.includes(adaptationState.tone) ? adaptationState.tone : "Экспертный");
    setAdaptationKeywords(adaptationState.keywords ?? "");
    setAdaptationInstructions(adaptationState.instructions ?? "");
    setAdaptationResult(adaptationState.mode === "ai" ? adaptationState.result ?? null : null);
    setAdaptationMode(adaptationState.mode === "ai" ? "ai" : "example");
    setAdaptationError("");

    window.requestAnimationFrame(() => setWorkspaceReady(true));
  }

  async function saveActiveWorkspaceBrand(showConfirmation = false) {
    if (!activeBrandId) return true;
    setWorkspaceSaving(true);
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_brand", brandId: activeBrandId, profile: effectiveBrand, workspace: workspaceSnapshot }),
      });
      const payload = await safeJson(response) as { error?: string; brand?: unknown; account?: WorkspaceAccount };
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить бренд.");
      const saved = normalizeWorkspaceBrand(payload.brand);
      if (saved) setWorkspaceBrands((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (payload.account) setWorkspaceAccount(payload.account);
      setBrandSaved(true);
      setWorkspaceDataError("");
      if (showConfirmation) showToast("Профиль и рабочие данные бренда сохранены");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить бренд.";
      setWorkspaceDataError(message);
      showToast(message);
      return false;
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function switchWorkspaceBrand(id: string) {
    if (!id || id === activeBrandId || brandSwitchBusy) return;
    const target = workspaceBrands.find((item) => item.id === id);
    if (!target) return;
    setBrandMenuOpen(false);
    setBrandSwitchBusy(true);
    const saved = await saveActiveWorkspaceBrand(false);
    if (saved) {
      applyWorkspaceBrand(target);
      showToast(`Открыт бренд «${target.name}»`);
    }
    setBrandSwitchBusy(false);
  }

  async function createWorkspaceBrand() {
    const name = newBrandName.trim();
    if (!name) {
      showToast("Введите название нового бренда");
      return;
    }
    if (workspaceBrands.length >= workspaceAccount.brandLimit) {
      showToast(`На тарифе «${workspaceAccount.planName}» доступно до ${workspaceAccount.brandLimit} брендов`);
      return;
    }
    const blankProfile: BrandProfile = {
      ...defaultBrand,
      name,
      website: "",
      description: "",
      positioning: "",
      audience: "",
      advantages: "",
      signature: `С заботой о вас, ${name}.`,
    };
    setBrandSwitchBusy(true);
    try {
      await saveActiveWorkspaceBrand(false);
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_brand", profile: blankProfile, workspace: { useBrand: true, profileMode: "quick" } }),
      });
      const payload = await safeJson(response) as { error?: string; brand?: unknown; account?: WorkspaceAccount };
      const created = normalizeWorkspaceBrand(payload.brand);
      if (!response.ok || !created) throw new Error(payload.error || "Не удалось создать бренд.");
      setWorkspaceBrands((current) => [...current, created]);
      if (payload.account) setWorkspaceAccount(payload.account);
      setNewBrandName("");
      setBrandCreatorOpen(false);
      applyWorkspaceBrand(created);
      showToast(`Бренд «${created.name}» создан`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось создать бренд.");
    } finally {
      setBrandSwitchBusy(false);
    }
  }

  function openArchiveItem(item: GenerationArchiveItem) {
    if (!item.brandId || item.brandId !== activeBrandId) {
      showToast("Этот материал относится к другому кабинету бренда");
      return;
    }
    const editable = { ...item };
    setArchiveEditorItem(editable);
    setArchiveEditorOriginal({ ...item });
    setArchiveEditorError("");
    setArchiveEditorChanges([]);
    setArchiveEditorTone(styles.includes(item.tone) ? item.tone : "Экспертный");
    setArchiveTransformGoal("proofread");
    showToast("Материал открыт в редакторе КЛИО");
  }

  function closeArchiveEditor() {
    if (archiveEditorBusy || archiveEditorSaving) return;
    if (archiveEditorDirty && !window.confirm("Закрыть редактор без сохранения изменений?")) return;
    setArchiveEditorItem(null);
    setArchiveEditorOriginal(null);
    setArchiveEditorChanges([]);
    setArchiveEditorError("");
  }

  async function saveArchiveItem(mode: "update" | "copy" = "update") {
    if (!archiveEditorItem) return;
    if (!archiveEditorItem.title.trim() || !archiveEditorItem.body.trim()) {
      setArchiveEditorError("Для сохранения нужны заголовок и текст материала.");
      return;
    }
    setArchiveEditorSaving(true);
    setArchiveEditorError("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode === "copy" ? "copy_generation" : "update_generation",
          generation: {
            id: archiveEditorItem.id,
            title: archiveEditorItem.title,
            body: archiveEditorItem.body,
            metaTitle: archiveEditorItem.metaTitle,
            metaDescription: archiveEditorItem.metaDescription,
            editorialComment: archiveEditorItem.editorialComment,
            tone: archiveEditorTone,
          },
        }),
      });
      const payload = await safeJson(response) as { error?: string; generation?: GenerationArchiveItem };
      if (!response.ok || !payload.generation) throw new Error(payload.error || "Не удалось сохранить материал.");
      const saved = payload.generation;
      setArchiveEditorItem({ ...saved });
      setArchiveEditorOriginal({ ...saved });
      setArchiveEditorChanges([]);
      if (mode === "copy") {
        setWorkspaceHistory((current) => [saved, ...current]);
        showToast("Новая версия сохранена как копия — лимит не изменился");
      } else {
        setWorkspaceHistory((current) => current.map((item) => item.id === saved.id ? saved : item));
        showToast("Материал пересохранён");
      }
    } catch (error) {
      setArchiveEditorError(error instanceof Error ? error.message : "Не удалось сохранить материал.");
    } finally {
      setArchiveEditorSaving(false);
    }
  }

  function copyArchiveItem() {
    if (!archiveEditorItem) return;
    navigator.clipboard?.writeText(`${archiveEditorItem.title}\n\n${archiveEditorItem.body}`);
    showToast("Материал скопирован");
  }

  function restoreArchiveOriginal() {
    if (!archiveEditorOriginal) return;
    setArchiveEditorItem({ ...archiveEditorOriginal });
    setArchiveEditorTone(styles.includes(archiveEditorOriginal.tone) ? archiveEditorOriginal.tone : "Экспертный");
    setArchiveEditorChanges([]);
    setArchiveEditorError("");
    showToast("Возвращена последняя сохранённая версия");
  }

  async function runArchiveEditor() {
    if (!archiveEditorItem) return;
    if (aiConnection !== "connected") {
      setArchiveEditorError("ИИ не подключён. Ручные правки и сохранение доступны, а режимы КЛИО заработают после подключения серверного AI‑доступа.");
      return;
    }
    const archivedBrand = archiveEditorItem.brandId
      ? workspaceBrands.find((item) => item.id === archiveEditorItem.brandId)?.profile
      : null;
    setArchiveEditorBusy(true);
    setArchiveEditorError("");
    try {
      const response = await fetch("/api/adapt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText: `${archiveEditorItem.title}\n\n${archiveEditorItem.body}`,
          goal: archiveTransformGoal,
          tone: archiveEditorTone,
          keywords: archiveEditorItem.keywords || "",
          instructions: "Доработать сохранённый материал внутри редактора. Сохранить подтверждённые факты; текущий черновик генератора не изменять.",
          brand: archivedBrand,
          useBrand: Boolean(archivedBrand),
        }),
      });
      const payload = await safeJson(response) as { error?: string; mode?: "ai"; material?: AdaptedMaterial; usage?: { account?: WorkspaceAccount } | null };
      if (!response.ok || !payload.material || payload.mode !== "ai") throw new Error(payload.error || "Редактор КЛИО не подготовил новую версию.");
      if (payload.usage?.account) setWorkspaceAccount(payload.usage.account);
      setArchiveEditorItem((current) => current ? {
        ...current,
        title: payload.material!.title,
        body: payload.material!.body,
        metaTitle: payload.material!.metaTitle,
        metaDescription: payload.material!.metaDescription,
        editorialComment: payload.material!.editorialComment,
        tone: archiveEditorTone,
      } : current);
      setArchiveEditorChanges(payload.material.changes);
      showToast(`${activeArchivePlan.title} завершил редактуру`);
    } catch (error) {
      setArchiveEditorError(error instanceof Error ? error.message : "Не удалось доработать материал.");
    } finally {
      setArchiveEditorBusy(false);
    }
  }

  function updateBrand(field: keyof BrandProfile, value: string) {
    setBrand((current) => ({ ...current, [field]: value }));
    setBrandSaved(false);
    if (["name", "website", "description", "positioning", "audience", "advantages"].includes(field)) {
      setSemanticNeedsRefresh(true);
      setContentPlanNeedsRefresh(true);
    }
  }

  function changeProfileMode(nextMode: ProfileMode) {
    if (nextMode === profileMode) return;
    if (nextMode === "expert" && profileMode === "quick" && foundationReady) {
      setBrand(effectiveBrand);
    }
    setProfileMode(nextMode);
    setBrandSaved(false);
    showToast(nextMode === "quick" ? "Включён быстрый старт с рекомендациями КЛИО" : "Открыта полная ручная настройка");
  }

  function applyVoiceRecommendations() {
    if (!foundationReady) {
      setBrandTab("foundation");
      showToast("Сначала заполните основу бренда, аудиторию и факты");
      return;
    }
    setBrand((current) => ({ ...current, ...buildVoiceRecommendations(current) }));
    setBrandSaved(false);
    showToast("Рекомендации по голосу добавлены в профиль");
  }

  function applyFormatRecommendations() {
    if (!foundationReady) {
      setBrandTab("foundation");
      showToast("Сначала заполните основу бренда, аудиторию и факты");
      return;
    }
    setBrand((current) => {
      const withVoice = { ...current, ...buildVoiceRecommendations(current) };
      return { ...withVoice, ...buildFormatRecommendations() };
    });
    setBrandSaved(false);
    showToast("Правила четырёх форматов предзаполнены");
  }

  function changeFormat(nextFormat: Format) {
    setFormat(nextFormat);
    setLength(defaultLengthByFormat[nextFormat]);
    setCustomLength(false);
  }

  function changeLength(value: string) {
    if (value === "custom") {
      setCustomLength(true);
      return;
    }

    setCustomLength(false);
    setLength(Number(value));
  }

  function setManualLength(value: string) {
    const nextLength = Number(value);
    if (!Number.isFinite(nextLength)) return;
    setLength(Math.min(4000, Math.max(30, Math.round(nextLength))));
  }

  async function saveBrand() {
    setBrand(effectiveBrand);
    if (workspace) {
      await saveActiveWorkspaceBrand(true);
      return;
    }
    window.localStorage.setItem("clio-brand-profile-v1", JSON.stringify(effectiveBrand));
    setBrandSaved(true);
    showToast("Профиль бренда сохранён");
  }

  function restoreBrand() {
    setBrand(defaultBrand);
    setProfileMode("quick");
    setSemanticNeedsRefresh(true);
    setContentPlanNeedsRefresh(true);
    if (!workspace) window.localStorage.setItem("clio-brand-profile-v1", JSON.stringify(defaultBrand));
    setBrandSaved(true);
    showToast("Базовый профиль восстановлен");
  }

  function persistSemantics(
    result: SemanticResult,
    selectedIds: string[],
    mode: SemanticMode,
    query = semanticQuery,
    region = semanticRegion,
    geo = semanticGeo,
    needsRefresh = semanticNeedsRefresh,
  ) {
    window.localStorage.setItem("clio-semantics-v1", JSON.stringify({ schemaVersion: 4, query, region, geo, result, selectedIds, mode, needsRefresh }));
  }

  function updateSemanticQuery(value: string) {
    setSemanticQuery(value);
    setSemanticNeedsRefresh(true);
    setContentPlanNeedsRefresh(true);
    setSemanticError("");
    persistSemantics(semanticResult, selectedSemanticIds, semanticMode, value, semanticRegion, semanticGeo, true);
  }

  function updateSemanticGeo(ids: string[]) {
    setSemanticNeedsRefresh(true);
    setContentPlanNeedsRefresh(true);
    setSemanticGeo((current) => {
      const selected = new Set(current.cityIds);
      const targetIds = ids.filter((id) => allGeoCityIds.has(id));
      const allSelected = targetIds.length > 0 && targetIds.every((id) => selected.has(id));
      targetIds.forEach((id) => allSelected ? selected.delete(id) : selected.add(id));
      const geo = { cityIds: [...selected] };
      const scopes = semanticGeoScopes(geo);
      const region = scopes.length ? scopes.map((scope) => scope.label).join(", ") : "Россия";
      persistSemantics(semanticResult, selectedSemanticIds, semanticMode, semanticQuery, region, geo, true);
      return geo;
    });
  }

  function removeSemanticGeoScope(scope: GeoScope) {
    setSemanticNeedsRefresh(true);
    setContentPlanNeedsRefresh(true);
    setSemanticGeo((current) => {
      const removed = new Set(scope.cityIds);
      const geo = { cityIds: current.cityIds.filter((id) => !removed.has(id)) };
      const scopes = semanticGeoScopes(geo);
      const region = scopes.length ? scopes.map((item) => item.label).join(", ") : "Россия";
      persistSemantics(semanticResult, selectedSemanticIds, semanticMode, semanticQuery, region, geo, true);
      return geo;
    });
  }

  function clearSemanticGeo() {
    const geo: SemanticGeo = { cityIds: [] };
    setSemanticNeedsRefresh(true);
    setContentPlanNeedsRefresh(true);
    setSemanticGeo(geo);
    persistSemantics(semanticResult, selectedSemanticIds, semanticMode, semanticQuery, "Россия", geo, true);
  }

  function toggleGeoDistrictOpen(name: string) {
    setOpenGeoDistricts((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  function toggleGeoRegionOpen(name: string) {
    setOpenGeoRegions((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  async function analyzeSemantics() {
    if (aiConnection !== "connected") {
      setSemanticError("ИИ не подключён. Семантика не будет подменена тестовым шаблоном: сначала добавьте серверный AI‑ключ.");
      return;
    }
    const cleanQuery = semanticQuery.trim();
    if (!cleanQuery) {
      setSemanticError("Введите основной запрос или тему.");
      return;
    }

    setSemanticBusy(true);
    setSemanticError("");
    try {
      const response = await fetch("/api/semantics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleanQuery,
          region: semanticRegion,
          geography: selectedGeoScopes.map(({ key, label, detail }) => ({ key, label, detail })),
          brand: useBrand ? effectiveBrand : null,
        }),
      });
      const payload = await safeJson(response) as {
        error?: string;
        mode?: "ai";
        result?: SemanticResult;
        usage?: { account?: WorkspaceAccount } | null;
      };
      if (!response.ok || !payload.result?.keywords?.length) {
        throw new Error(payload.error || "Не удалось собрать смысловые группы.");
      }

      if (payload.mode !== "ai") throw new Error("Семантика не получена от AI‑аналитика.");
      const normalizedResult = normalizeStoredSemanticResult(payload.result);
      if (!normalizedResult) throw new Error("AI‑аналитик вернул неполную семантическую карту.");
      const mode: SemanticMode = "ai";
      const recommendedIds = normalizedResult.keywords.filter((item) => item.recommended).map((item) => item.id).slice(0, 8);
      if (payload.usage?.account) setWorkspaceAccount(payload.usage.account);
      setSemanticResult(normalizedResult);
      setSelectedSemanticIds(recommendedIds);
      setSemanticMode(mode);
      setSemanticNeedsRefresh(false);
      setActiveSemanticCluster("Все группы");
      setCompetitorQuery(normalizedResult.primaryQuery || cleanQuery);
      setCompetitorNeedsRefresh(true);
      setContentPlanNeedsRefresh(true);
      persistSemantics(normalizedResult, recommendedIds, mode, cleanQuery, semanticRegion, semanticGeo, false);
      showToast("Семантика подготовлена AI‑аналитиком");
    } catch (error) {
      setSemanticError(error instanceof Error ? error.message : "Не удалось выполнить анализ.");
    } finally {
      setSemanticBusy(false);
    }
  }

  function toggleSemanticKeyword(id: string) {
    setContentPlanNeedsRefresh(true);
    setSelectedSemanticIds((current) => {
      if (current.includes(id)) {
        const next = current.filter((item) => item !== id);
        persistSemantics(semanticResult, next, semanticMode);
        return next;
      }
      if (current.length >= 8) {
        showToast("Для одного материала рекомендуем не более 8 фраз");
        return current;
      }
      const next = [...current, id];
      persistSemantics(semanticResult, next, semanticMode);
      return next;
    });
  }

  function selectRecommendedSemantics() {
    const next = semanticResult.keywords.filter((item) => item.recommended).map((item) => item.id).slice(0, 8);
    setSelectedSemanticIds(next);
    setContentPlanNeedsRefresh(true);
    persistSemantics(semanticResult, next, semanticMode);
    showToast("КЛИО выбрала сбалансированный набор без переспама");
  }

  function clearSemanticSelection() {
    setSelectedSemanticIds([]);
    setContentPlanNeedsRefresh(true);
    persistSemantics(semanticResult, [], semanticMode);
  }

  function sendSemanticsToGenerator() {
    if (semanticNeedsRefresh) {
      showToast("Сначала обновите семантику по текущей теме и географии");
      return;
    }
    if (!selectedSemanticKeywords.length) {
      showToast("Сначала выберите хотя бы одну ключевую фразу");
      return;
    }
    setFormat("seo");
    setGeneratorMode("advanced");
    setTopic(semanticResult.suggestedTopic || semanticQuery);
    setKeywords(selectedSemanticKeywords.map((item) => item.phrase).join(", "));
    setLength(Math.min(4000, Math.max(500, semanticResult.recommendedLength || 1200)));
    setCustomLength(false);
    setGeneratorUseSemantics(true);
    setGenerationMode("example");
    window.setTimeout(() => document.getElementById("generator")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    showToast(`${selectedSemanticKeywords.length} фраз и тема переданы в генератор`);
  }

  async function requestGeneratedMaterial(requestBody: {
    format: Format;
    topic: string;
    keywords: string;
    tone: string;
    length: number;
    accent: string;
    useBrand: boolean;
    useSemantics?: boolean;
    useCompetitors?: boolean;
  }) {
    const includeBrand = requestBody.useBrand && generatorBrandReady;
    const includeSemantics = requestBody.useSemantics !== false && generatorSemanticsReady;
    const includeCompetitors = requestBody.useCompetitors !== false && generatorCompetitorsReady;
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        brandId: activeBrandId || undefined,
        useBrand: includeBrand,
        useSemantics: includeSemantics,
        useCompetitors: includeCompetitors,
        brand: includeBrand ? effectiveBrand : undefined,
        geography: includeSemantics ? selectedGeoScopes.map(({ key, label, detail }) => ({ key, label, detail })) : [],
        semanticContext: includeSemantics ? {
          query: semanticResult.primaryQuery || semanticQuery,
          intent: semanticResult.intent,
          suggestedTopic: semanticResult.suggestedTopic,
          selectedKeywords: selectedSemanticKeywords.map((item) => ({
            phrase: item.phrase,
            breadth: item.breadth,
            role: item.role,
            cluster: item.cluster,
            intent: item.intent,
          })),
        } : null,
        competitorContext: includeCompetitors ? {
          query: competitorResult.query || competitorQuery,
          selectedTopics: selectedCompetitorTopics.map((item) => ({
            title: item.title,
            cluster: item.cluster,
            priority: item.priority,
            rationale: item.rationale,
            opportunity: item.opportunity,
          })),
          commonTopics: competitorResult.commonTopics,
          gaps: competitorResult.gaps,
          suggestedStructure: competitorResult.suggestedStructure,
        } : null,
      }),
    });
    const payload = await safeJson(response) as {
      error?: string;
      mode?: "ai";
      material?: GeneratedMaterial;
      coverage?: GenerationCoverage;
      usage?: { account?: WorkspaceAccount; archive?: GenerationArchiveItem } | null;
    };
    if (!response.ok || !payload.material) throw new Error(payload.error || "Не удалось сформировать материал.");
    if (payload.usage?.account) setWorkspaceAccount(payload.usage.account);
    if (payload.usage?.archive) setWorkspaceHistory((current) => [payload.usage!.archive!, ...current.filter((item) => item.id !== payload.usage!.archive!.id)].slice(0, 60));
    if (payload.mode !== "ai") throw new Error("Материал не получен от AI‑редакции.");
    return { material: payload.material, mode: "ai" as const, coverage: payload.coverage ?? null };
  }

  function applyGeneratedMaterial(material: GeneratedMaterial, mode: "demo" | "ai", coverage: GenerationCoverage | null = null) {
    setTitle(material.title);
    setBody(material.body);
    setMetaTitle(material.metaTitle);
    setMetaDescription(material.metaDescription);
    setEditorNote(material.editorialComment);
    setGenerationMode(mode);
    setGenerationCoverage(coverage);
    setMetricsVisible(true);
    setMetricsReplay((value) => value + 1);
  }

  async function generateFromSemantics() {
    if (aiConnection !== "connected") {
      setSemanticError("ИИ не подключён. Создание статьи отключено, чтобы не выдавать шаблон вместо вашей темы.");
      return;
    }
    if (semanticNeedsRefresh) {
      showToast("Сначала обновите семантику по текущей теме и географии");
      return;
    }
    if (!selectedSemanticKeywords.length) {
      showToast("Сначала выберите хотя бы одну ключевую фразу");
      return;
    }

    const nextTopic = semanticResult.suggestedTopic || semanticQuery;
    const nextKeywords = selectedSemanticKeywords.map((item) => item.phrase).join(", ");
    const nextLength = Math.min(4000, Math.max(500, semanticResult.recommendedLength || 1200));
    setFormat("seo");
    setTopic(nextTopic);
    setKeywords(nextKeywords);
    setLength(nextLength);
    setCustomLength(false);
    setSemanticArticleBusy(true);
    setSemanticError("");
    try {
      const response = await requestGeneratedMaterial({
        format: "seo",
        topic: nextTopic,
        keywords: nextKeywords,
        tone: "Экспертный",
        length: nextLength,
        accent: "Создать самостоятельную полезную статью по выбранному поисковому интенту",
        useBrand: useBrand && generatorUseBrand,
        useSemantics: true,
        useCompetitors: generatorUseCompetitors,
      });
      applyGeneratedMaterial(response.material, response.mode, response.coverage);
      window.setTimeout(() => document.getElementById("generator")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      showToast(useBrand && generatorUseBrand ? "Статья создана по семантике и профилю бренда" : "Статья создана только по семантике — модуль 01 пропущен");
    } catch (error) {
      setSemanticError(error instanceof Error ? error.message : "Не удалось создать статью по семантике.");
    } finally {
      setSemanticArticleBusy(false);
    }
  }

  function persistCompetitorWorkspace(options: {
    query?: string;
    focusSource?: CompetitorFocusSource;
    entries?: CompetitorEntry[];
    comment?: string;
    result?: CompetitorResult;
    selectedIds?: string[];
    mode?: CompetitorMode;
    needsRefresh?: boolean;
  } = {}) {
    window.localStorage.setItem("clio-competitors-v1", JSON.stringify({
      query: options.query ?? competitorQuery,
      focusSource: options.focusSource ?? competitorFocusSource,
      competitors: options.entries ?? competitors,
      comment: options.comment ?? competitorComment,
      result: options.result ?? competitorResult,
      selectedIds: options.selectedIds ?? selectedCompetitorTopicIds,
      mode: options.mode ?? competitorMode,
      needsRefresh: options.needsRefresh ?? competitorNeedsRefresh,
    }));
  }

  function updateCompetitorEntry(id: string, field: "label" | "url", value: string) {
    const next = competitors.map((item) => item.id === id
      ? { ...item, [field]: value, ...(field === "url" ? { origin: "manual" as const } : {}) }
      : item);
    setCompetitors(next);
    setCompetitorNeedsRefresh(true);
    setCompetitorError("");
    persistCompetitorWorkspace({ entries: next, needsRefresh: true });
  }

  function addCompetitorEntry() {
    if (competitors.length >= 5) {
      showToast("В одну матрицу можно добавить до 5 конкурентов");
      return;
    }
    const next = [
      ...competitors,
      { id: `competitor-${Date.now()}`, label: `Конкурент ${competitors.length + 1}`, url: "" },
    ];
    setCompetitors(next);
    setCompetitorNeedsRefresh(true);
    persistCompetitorWorkspace({ entries: next, needsRefresh: true });
  }

  function removeCompetitorEntry(id: string) {
    if (competitors.length <= 2) {
      showToast("Для сравнения оставьте хотя бы две строки");
      return;
    }
    const next = competitors.filter((item) => item.id !== id);
    setCompetitors(next);
    setCompetitorNeedsRefresh(true);
    persistCompetitorWorkspace({ entries: next, needsRefresh: true });
  }

  function useCurrentSemanticsForCompetitors() {
    if (!semanticAnalysisReady) {
      showToast("Сначала соберите актуальную семантику в разделе «Семантика»");
      document.getElementById("semantics")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const nextQuery = semanticResult.primaryQuery || semanticQuery;
    setCompetitorQuery(nextQuery);
    setCompetitorFocusSource("semantics");
    setCompetitorNeedsRefresh(true);
    persistCompetitorWorkspace({ query: nextQuery, focusSource: "semantics", needsRefresh: true });
    showToast("Основной запрос из семантики передан в анализ конкурентов");
  }

  function useBrandForCompetitors() {
    const nextQuery = brandComparisonTheme(effectiveBrand);
    if (!nextQuery) {
      showToast("Сначала заполните название и описание бренда в разделе «Профиль бренда»");
      return;
    }
    setUseBrand(true);
    setCompetitorQuery(nextQuery);
    setCompetitorFocusSource("brand");
    setCompetitorNeedsRefresh(true);
    setCompetitorError("");
    persistCompetitorWorkspace({ query: nextQuery, focusSource: "brand", needsRefresh: true });
    showToast("Категория и позиционирование бренда переданы в сравнение");
  }

  function openCompetitorAnalysis() {
    setCompetitorOpen(true);
    window.setTimeout(() => document.getElementById("competitors")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  async function discoverCompetitors() {
    if (aiConnection !== "connected") {
      setCompetitorError("Автопоиск требует подключённого ИИ. КЛИО не придумывает ссылки — добавьте их вручную или подключите серверный AI‑доступ.");
      return;
    }
    const cleanQuery = competitorQuery.trim() || brandComparisonTheme(effectiveBrand);
    if (!cleanQuery) {
      setCompetitorError("Укажите тему либо возьмите основу из семантики или профиля бренда.");
      return;
    }

    setCompetitorDiscoveryBusy(true);
    setCompetitorDiscoveryNote("");
    setCompetitorError("");
    try {
      const response = await fetch("/api/competitors/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleanQuery,
          // Only attach the brand profile when the visitor's query actually
          // came from it (competitorFocusSource === "brand"). Falling back
          // to the shared useBrand toggle here used to pull the brand into
          // an intentionally independent, manually typed search.
          brand: competitorFocusSource === "brand" && useBrand ? effectiveBrand : null,
          geography: selectedGeoScopes.map(({ label, detail }) => ({ label, detail })),
        }),
      });
      const payload = await safeJson(response) as {
        error?: string;
        candidates?: CompetitorEntry[];
      };
      if (!response.ok || !payload.candidates?.length) throw new Error(payload.error || "ИИ не нашёл подходящие страницы.");

      // Keep only what the visitor typed themselves — re-running discovery
      // is a request for fresh candidates. Previously this kept *every*
      // filled slot (including ones from an earlier discovery) ahead of
      // the new results, so once 5 slots were full, slice(0, 5) silently
      // dropped every new candidate and re-discovery always looked like
      // "the same competitors, every time".
      const manualEntries = competitors.filter((item) => item.origin === "manual" && item.url.trim());
      const used = new Set(manualEntries.map((item) => comparableUrl(item.url)));
      const discovered = payload.candidates.filter((item) => {
        const key = comparableUrl(item.url);
        if (!key || used.has(key)) return false;
        used.add(key);
        return true;
      });
      const next = [...manualEntries, ...discovered].slice(0, 5);
      while (next.length < 2) next.push({ id: `competitor-${Date.now()}-${next.length}`, label: `Конкурент ${next.length + 1}`, url: "", origin: "manual" });

      setCompetitors(next);
      setCompetitorNeedsRefresh(true);
      setCompetitorDiscoveryNote(`ИИ нашёл ${payload.candidates.length} ${payload.candidates.length === 1 ? "страницу" : payload.candidates.length < 5 ? "страницы" : "страниц"}. Они добавлены в список — при необходимости отредактируйте его и постройте матрицу.`);
      persistCompetitorWorkspace({ query: cleanQuery, entries: next, needsRefresh: true });
      showToast(`${payload.candidates.length} страниц конкурентов добавлены из веб‑поиска`);
    } catch (error) {
      setCompetitorError(error instanceof Error ? error.message : "Не удалось найти конкурентов автоматически.");
    } finally {
      setCompetitorDiscoveryBusy(false);
    }
  }

  async function analyzeCompetitors() {
    const cleanQuery = competitorQuery.trim();
    const activeCompetitors = competitors
      .map((item) => ({ ...item, label: item.label.trim(), url: item.url.trim() }))
      .filter((item) => item.url);

    if (!cleanQuery) {
      setCompetitorError("Укажите тему или основной запрос для сравнения.");
      return;
    }
    if (activeCompetitors.length < 2) {
      setCompetitorError("Добавьте ссылки минимум на две страницы конкурентов.");
      return;
    }

    setCompetitorBusy(true);
    setCompetitorError("");
    try {
      const response = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleanQuery,
          competitors: activeCompetitors,
          semanticKeywords: competitorFocusSource === "semantics" && semanticAnalysisReady
            ? selectedSemanticKeywords.map((item) => ({ phrase: item.phrase, cluster: item.cluster, role: item.role }))
            : [],
          // Unlike discovery (which biases a *search*), the matrix always
          // compares against "Ваш бренд" when the profile is on — that
          // comparison is the point of the table regardless of where the
          // query text came from. Gating this on focusSource too made every
          // brand cell show "?" whenever the query wasn't from the brand.
          brand: useBrand ? effectiveBrand : null,
        }),
      });
      const payload = await safeJson(response) as {
        error?: string;
        mode?: "demo" | "ai";
        result?: CompetitorResult;
        usage?: { account?: WorkspaceAccount } | null;
      };
      if (!response.ok || !payload.result?.topics?.length) throw new Error(payload.error || "Не удалось построить матрицу конкурентов.");

      const mode: CompetitorMode = payload.mode === "ai" ? "ai" : "demo";
      if (payload.usage?.account) setWorkspaceAccount(payload.usage.account);
      const selectedIds = payload.result.topics.filter((item) => item.recommended).map((item) => item.id).slice(0, 6);
      setCompetitorResult(payload.result);
      setSelectedCompetitorTopicIds(selectedIds);
      setCompetitorMode(mode);
      setCompetitorNeedsRefresh(false);
      setContentPlanNeedsRefresh(true);
      persistCompetitorWorkspace({
        query: cleanQuery,
        entries: competitors,
        result: payload.result,
        selectedIds,
        mode,
        needsRefresh: false,
      });
      showToast(payload.result.competitors.some((item) => item.status === "loaded")
        ? "Матрица построена по доступным страницам"
        : "Страницы недоступны — матрица показывает только структуру темы");
    } catch (error) {
      setCompetitorError(error instanceof Error ? error.message : "Не удалось выполнить анализ конкурентов.");
    } finally {
      setCompetitorBusy(false);
    }
  }

  function toggleCompetitorTopic(id: string) {
    setContentPlanNeedsRefresh(true);
    setSelectedCompetitorTopicIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 6);
      if (!current.includes(id) && current.length >= 6) showToast("Для одного брифа выберите не более 6 выводов");
      persistCompetitorWorkspace({ selectedIds: next });
      return next;
    });
  }

  function selectRecommendedCompetitorTopics() {
    const next = competitorResult.topics.filter((item) => item.recommended).map((item) => item.id).slice(0, 6);
    setSelectedCompetitorTopicIds(next);
    setContentPlanNeedsRefresh(true);
    persistCompetitorWorkspace({ selectedIds: next });
    showToast("Рекомендованные выводы добавлены в будущий бриф");
  }

  function sendCompetitorInsightsToGenerator() {
    if (competitorNeedsRefresh) {
      if (validCompetitorEntries < 2) {
        setCompetitorError("Добавьте минимум две страницы вручную или найдите их с ИИ, затем постройте матрицу.");
        document.querySelector(".competitor-source-list")?.scrollIntoView({ behavior: "smooth", block: "center" });
        showToast("Для передачи выводов сначала нужны минимум две страницы");
      } else {
        showToast("Сначала обновите матрицу по текущей теме и ссылкам");
      }
      return;
    }
    if (!selectedCompetitorTopics.length) {
      showToast("Выберите хотя бы один вывод для будущего материала");
      return;
    }
    const insightLines = selectedCompetitorTopics.map((item) => `• ${item.title}: ${item.opportunity}`);
    const nextAccent = [
      "Использовать выводы матрицы как редакционные ориентиры; не копировать структуру и формулировки конкурентов.",
      ...insightLines,
      competitorComment.trim() ? `Комментарий пользователя: ${competitorComment.trim()}` : "",
    ].filter(Boolean).join("\n");
    setFormat("seo");
    setGeneratorMode("advanced");
    setTopic(competitorQuery);
    setAccent(nextAccent);
    setGeneratorUseCompetitors(true);
    setGenerationError("");
    setGenerationMode("example");
    window.setTimeout(() => document.getElementById("generator")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    showToast(`Тема и ${selectedCompetitorTopics.length} выводов переданы в генератор`);
  }

  function downloadWorkspaceFile(filename: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveModuleMaterial(type: SavedMaterialType, saveMode: "version" | "copy" = "version") {
    if (!activeBrandId || materialSavingType) return;
    const sourceId = moduleMaterialSources[type];
    const material = type === "semantics"
      ? {
        type,
        title: semanticResult.suggestedTopic || semanticQuery || "Семантическая карта",
        status: semanticNeedsRefresh ? "Требует обновления" : "Актуально",
        payload: { query: semanticQuery, geo: semanticGeo, result: semanticResult, selectedIds: selectedSemanticIds, mode: semanticMode, needsRefresh: semanticNeedsRefresh },
      }
      : type === "competitors"
        ? {
          type,
          title: competitorResult.query || competitorQuery || "Анализ конкурентов",
          status: competitorNeedsRefresh ? "Требует обновления" : "Актуально",
          payload: { query: competitorQuery, focusSource: competitorFocusSource, entries: competitors, comment: competitorComment, result: competitorResult, selectedIds: selectedCompetitorTopicIds, mode: competitorMode, needsRefresh: competitorNeedsRefresh },
        }
        : {
          type,
          title: contentPlanResult.query || contentPlanQuery || "Контент‑план",
          status: `${contentPlanProgress.ready} готово · ${contentPlanProgress.working} в работе`,
          payload: { query: contentPlanQuery, count: contentPlanCount, result: contentPlanResult, mode: contentPlanMode, needsRefresh: contentPlanNeedsRefresh },
        };

    const hasResult = type === "semantics"
      ? semanticAnalysisReady
      : type === "competitors"
        ? competitorMode !== "example" && competitorResult.topics.length > 0
        : contentPlanMode === "ai" && contentPlanResult.items.length > 0;
    if (!hasResult) {
      showToast("Сначала подготовьте результат модуля");
      return;
    }

    setMaterialSavingType(type);
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_material",
          material: { ...material, brandId: activeBrandId, sourceId, saveMode },
        }),
      });
      const payload = await safeJson(response) as { error?: string; material?: SavedWorkspaceMaterial };
      if (!response.ok || !payload.material) throw new Error(payload.error || "Не удалось сохранить материал.");
      setWorkspaceMaterials((current) => [payload.material!, ...current.filter((item) => item.id !== payload.material!.id)].slice(0, 120));
      setModuleMaterialSources((current) => ({ ...current, [type]: payload.material!.id }));
      showToast(sourceId && saveMode === "version" ? `Версия ${payload.material.versionNumber} сохранена` : saveMode === "copy" ? "Материал сохранён отдельной копией" : "Материал добавлен в раздел «Материалы»");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось сохранить материал.");
    } finally {
      setMaterialSavingType(null);
    }
  }

  function openSavedMaterial(item: SavedWorkspaceMaterial) {
    if (item.brandId !== activeBrandId) return;
    setHistoryOpen(false);
    setModuleMaterialSources((current) => ({ ...current, [item.type]: item.id }));

    if (item.type === "semantics") {
      const payload = item.payload as BrandWorkspaceSnapshot["semantics"];
      const storedResult = normalizeStoredSemanticResult(payload?.result);
      if (!storedResult) return showToast("Сохранённая семантика повреждена или устарела");
      setSemanticQuery(payload?.query || storedResult.primaryQuery);
      setSemanticGeo(payload?.geo ? normalizeStoredGeo(payload.geo) : defaultSemanticGeo);
      setSemanticResult(storedResult);
      setSelectedSemanticIds(Array.isArray(payload?.selectedIds) ? payload!.selectedIds! : storedResult.keywords.filter((keyword) => keyword.recommended).map((keyword) => keyword.id));
      setSemanticMode("ai");
      setSemanticNeedsRefresh(Boolean(payload?.needsRefresh));
      setSemanticOpen(true);
      window.setTimeout(() => document.getElementById("semantics")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } else if (item.type === "competitors") {
      const payload = item.payload as BrandWorkspaceSnapshot["competitors"];
      if (!payload?.result?.topics?.length) return showToast("Сохранённый анализ повреждён или устарел");
      setCompetitorQuery(payload.query || payload.result.query);
      setCompetitorFocusSource(payload.focusSource === "semantics" || payload.focusSource === "brand" ? payload.focusSource : "manual");
      setCompetitors(Array.isArray(payload.entries) && payload.entries.length ? payload.entries : defaultCompetitors);
      setCompetitorComment(payload.comment || "");
      setCompetitorResult(payload.result);
      setSelectedCompetitorTopicIds(Array.isArray(payload.selectedIds) ? payload.selectedIds : []);
      setCompetitorMode(payload.mode === "ai" ? "ai" : "demo");
      setCompetitorNeedsRefresh(Boolean(payload.needsRefresh));
      setCompetitorOpen(true);
      window.setTimeout(() => document.getElementById("competitors")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } else {
      const payload = item.payload as BrandWorkspaceSnapshot["contentPlan"];
      const storedResult = normalizeStoredContentPlanResult(payload?.result);
      if (!storedResult) return showToast("Сохранённый контент‑план повреждён или устарел");
      setContentPlanQuery(payload?.query || storedResult.query);
      setContentPlanCount(payload?.count === 10 || payload?.count === 15 || payload?.count === 25 ? payload.count : storedResult.items.length >= 25 ? 25 : storedResult.items.length >= 15 ? 15 : 10);
      setContentPlanResult(storedResult);
      setContentPlanMode("ai");
      setContentPlanNeedsRefresh(Boolean(payload?.needsRefresh));
      setSelectedPlanItemIds([]);
      setPlanReplacements([]);
      setContentPlanOpen(true);
      window.setTimeout(() => document.getElementById("content-plan")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
    showToast(`Открыта версия ${item.versionNumber} в модуле КЛИО`);
  }

  function exportSavedMaterial(item: SavedWorkspaceMaterial) {
    if (item.type === "semantics") {
      const result = normalizeStoredSemanticResult((item.payload as BrandWorkspaceSnapshot["semantics"])?.result);
      if (!result) return showToast("Не удалось подготовить экспорт");
      const rows = [["Фраза", "Кластер", "Интент", "Роль", "Связь", "Охват", "Рекомендовано"], ...result.keywords.map((keyword) => [keyword.phrase, keyword.cluster, keyword.intent, keyword.role, keyword.relation, keyword.breadth, keyword.recommended ? "Да" : "Нет"])];
      const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\r\n")}`;
      downloadWorkspaceFile("klio-semantics.csv", csv, "text/csv;charset=utf-8");
    } else if (item.type === "content_plan") {
      const result = normalizeStoredContentPlanResult((item.payload as BrandWorkspaceSnapshot["contentPlan"])?.result);
      if (!result) return showToast("Не удалось подготовить экспорт");
      const rows = [["№", "Статус", "Тема", "Формат", "Кластер", "Интент", "Основной запрос", "Ракурс", "Цель"], ...result.items.map((planItem, index) => [String(index + 1), planItem.status, planItem.title, planItem.format, planItem.cluster, planItem.intent, planItem.primaryKeyword, planItem.angle, planItem.objective])];
      const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\r\n")}`;
      downloadWorkspaceFile("klio-content-plan.csv", csv, "text/csv;charset=utf-8");
    } else {
      const result = (item.payload as BrandWorkspaceSnapshot["competitors"])?.result;
      if (!result?.topics?.length) return showToast("Не удалось подготовить экспорт");
      const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
      const rows = result.topics.map((topic) => `<tr><td>${escapeHtml(topic.title)}</td><td>${escapeHtml(topic.cluster)}</td><td>${escapeHtml(topic.priority)}</td><td>${escapeHtml(topic.opportunity)}</td></tr>`).join("");
      const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(item.title)}</title><style>body{font-family:Arial,sans-serif;color:#10233d;padding:32px}h1{font-size:26px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #c9d4e2;padding:8px;text-align:left;vertical-align:top}th{background:#eaf0f7}</style></head><body><h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(result.dataNote)}</p><table><thead><tr><th>Тема</th><th>Кластер</th><th>Приоритет</th><th>Редакционная возможность</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
      downloadWorkspaceFile("klio-competitor-analysis.doc", `\uFEFF${documentHtml}`, "application/msword;charset=utf-8");
    }
    showToast("Материал подготовлен к скачиванию");
  }

  async function deleteArchiveItem(item: GenerationArchiveItem) {
    if (!window.confirm(`Удалить «${item.title}»? Это действие необратимо.`)) return;
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_generation", id: item.id }),
      });
      const payload = await safeJson(response) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить материал.");
      setWorkspaceHistory((current) => current.filter((entry) => entry.id !== item.id));
      showToast("Материал удалён");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось удалить материал.");
    }
  }

  async function deleteSavedMaterial(item: SavedWorkspaceMaterial) {
    if (!window.confirm(`Удалить «${item.title}»? Это действие необратимо.`)) return;
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_material", id: item.id }),
      });
      const payload = await safeJson(response) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось удалить материал.");
      setWorkspaceMaterials((current) => current.filter((entry) => entry.id !== item.id));
      showToast("Материал удалён");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось удалить материал.");
    }
  }

  // Used by the content-plan "источники" strip: each chip is a shortcut
  // to the module it reports on, not just a read-only status light —
  // open that module and scroll it into view instead of leaving people
  // to hunt for it themselves.
  function goToModule(id: string, open: () => void) {
    open();
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function persistContentPlan(options: {
    query?: string;
    goal?: ContentPlanGoal;
    count?: number;
    result?: ContentPlanResult;
    mode?: ContentPlanMode;
    needsRefresh?: boolean;
  } = {}) {
    window.localStorage.setItem("clio-content-plan-v1", JSON.stringify({
      query: options.query ?? contentPlanQuery,
      goal: options.goal ?? contentPlanGoal,
      count: options.count ?? contentPlanCount,
      result: options.result ?? contentPlanResult,
      mode: options.mode ?? contentPlanMode,
      needsRefresh: options.needsRefresh ?? contentPlanNeedsRefresh,
    }));
  }

  function useCurrentSemanticsForPlan() {
    if (!semanticAnalysisReady) {
      showToast("Сначала соберите актуальную семантику или укажите тему вручную");
      return;
    }
    const nextQuery = semanticResult.primaryQuery || semanticQuery;
    setContentPlanQuery(nextQuery);
    setContentPlanNeedsRefresh(true);
    setContentPlanError("");
    persistContentPlan({ query: nextQuery, needsRefresh: true });
    showToast("Тема и выбранная семантика готовы для контент‑плана");
  }

  async function buildContentPlan() {
    if (aiConnection !== "connected") {
      setContentPlanError("ИИ не подключён. Контент‑план не строится по демонстрационным заготовкам — сначала подключите серверный AI‑доступ.");
      return;
    }
    const cleanQuery = contentPlanQuery.trim() || (semanticAnalysisReady ? semanticResult.primaryQuery || semanticQuery : topic.trim());
    if (!cleanQuery) {
      setContentPlanError("Укажите основную тему контент‑плана или возьмите её из семантики.");
      return;
    }
    setContentPlanBusy(true);
    setContentPlanError("");
    try {
      const response = await fetch("/api/content-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleanQuery,
          goal: contentPlanGoal,
          count: contentPlanCount,
          semantics: semanticAnalysisReady ? selectedSemanticKeywords.map((item) => ({
            phrase: item.phrase,
            cluster: item.cluster,
            intent: item.intent,
            breadth: item.breadth,
            relation: item.relation,
          })) : [],
          geography: selectedGeoScopes.map(({ label, detail }) => ({ label, detail })),
          competitorInsights: !competitorNeedsRefresh ? selectedCompetitorTopics.map((item) => `${item.title}: ${item.opportunity}`) : [],
          brand: useBrand ? effectiveBrand : null,
        }),
      });
      const payload = await safeJson(response) as {
        error?: string;
        mode?: "ai";
        result?: Omit<ContentPlanResult, "items"> & { items: Array<Omit<ContentPlanItem, "status">> };
        usage?: { account?: WorkspaceAccount } | null;
      };
      if (!response.ok || !payload.result?.items?.length) throw new Error(payload.error || "Не удалось собрать контент‑план.");
      if (payload.mode !== "ai") throw new Error("Контент‑план не получен от AI‑стратега.");
      if (payload.usage?.account) setWorkspaceAccount(payload.usage.account);
      const result: ContentPlanResult = {
        ...payload.result,
        items: payload.result.items.map((item, index) => normalizeContentPlanItem({ ...item, status: "Запланировано" }, index)),
      };
      const mode: ContentPlanMode = "ai";
      setContentPlanQuery(cleanQuery);
      setContentPlanResult(result);
      setContentPlanMode(mode);
      setContentPlanNeedsRefresh(false);
      setExpandedPlanItem(result.items[0]?.id ?? null);
      setSelectedPlanItemIds([]);
      setPlanReplacements([]);
      setPlanReplacementOpen(false);
      persistContentPlan({ query: cleanQuery, result, mode, needsRefresh: false });
      showToast(`${result.items.length} тем собраны в единую контентную систему`);
    } catch (error) {
      setContentPlanError(error instanceof Error ? error.message : "Не удалось собрать контент‑план.");
    } finally {
      setContentPlanBusy(false);
    }
  }

  function updateContentPlanStatus(id: string, status: ContentPlanStatus) {
    const result = {
      ...contentPlanResult,
      items: contentPlanResult.items.map((item) => item.id === id ? { ...item, status } : item),
    };
    setContentPlanResult(result);
    setContentPlanNeedsRefresh(false);
    persistContentPlan({ result });
  }

  function togglePlanItemSelection(id: string) {
    setSelectedPlanItemIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 5) {
        showToast("За одно действие можно заменить не более пяти тем");
        return current;
      }
      return [...current, id];
    });
    setPlanReplacements([]);
    setPlanReplacementError("");
  }

  async function requestPlanReplacements() {
    const selectedItems = contentPlanResult.items.filter((item) => selectedPlanItemIds.includes(item.id));
    if (!selectedItems.length) {
      setPlanReplacementError("Выберите от одной до пяти тем.");
      return;
    }
    setPlanReplacementBusy(true);
    setPlanReplacementError("");
    try {
      const response = await fetch("/api/content-plan/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: contentPlanResult.query || contentPlanQuery,
          selectedItems,
          existingTitles: contentPlanResult.items.map((item) => item.title),
          preference: planReplacementPreference,
          comment: planReplacementComment,
          brand: useBrand ? effectiveBrand : null,
        }),
      });
      const payload = await safeJson(response) as {
        error?: string;
        mode?: "ai";
        replacements?: Array<{ sourceId: string; alternatives: Array<Omit<ContentPlanItem, "id" | "status">> }>;
        usage?: { account?: WorkspaceAccount } | null;
      };
      if (!response.ok || payload.mode !== "ai" || !payload.replacements?.length) throw new Error(payload.error || "Не удалось подобрать альтернативы.");
      if (payload.usage?.account) setWorkspaceAccount(payload.usage.account);
      const replacements = payload.replacements.map((group) => {
        const source = contentPlanResult.items.find((item) => item.id === group.sourceId);
        return {
          sourceId: group.sourceId,
          alternatives: group.alternatives.map((alternative, index) => normalizeContentPlanItem({
            ...alternative,
            id: `replacement-${group.sourceId}-${index + 1}`,
            status: source?.status || "Запланировано",
          }, index)),
        };
      });
      setPlanReplacements(replacements);
      showToast(`Подготовлены варианты для ${replacements.length} ${replacements.length === 1 ? "темы" : "тем"}`);
    } catch (error) {
      setPlanReplacementError(error instanceof Error ? error.message : "Не удалось подобрать альтернативы.");
    } finally {
      setPlanReplacementBusy(false);
    }
  }

  function applyPlanReplacement(sourceId: string, alternative: ContentPlanItem) {
    const source = contentPlanResult.items.find((item) => item.id === sourceId);
    if (!source) return;
    const nextItem = { ...alternative, id: sourceId, status: source.status };
    const result = {
      ...contentPlanResult,
      items: contentPlanResult.items.map((item) => item.id === sourceId ? nextItem : item),
      clusters: uniqueText(contentPlanResult.items.map((item) => item.id === sourceId ? nextItem.cluster : item.cluster)),
    };
    setContentPlanResult(result);
    setSelectedPlanItemIds((current) => current.filter((item) => item !== sourceId));
    setContentPlanNeedsRefresh(false);
    setPlanReplacements((current) => current.filter((item) => item.sourceId !== sourceId));
    setExpandedPlanItem(sourceId);
    persistContentPlan({ result, needsRefresh: false });
    showToast("Тема заменена, остальные строки плана сохранены");
  }

  function keepOriginalPlanItem(sourceId: string) {
    setSelectedPlanItemIds((current) => current.filter((item) => item !== sourceId));
    setPlanReplacements((current) => current.filter((item) => item.sourceId !== sourceId));
    showToast("Исходная тема сохранена");
  }

  function sendPlanItemToGenerator(item: ContentPlanItem) {
    const cleanTitle = cleanContentPlanTitle(item.title);
    const structureLines = item.structure.map((section) => `• ${section}: раскрыть применительно к теме материала и опереться только на подтверждённые факты`);
    const targetFormat = contentPlanFormatToGeneratorFormat[item.format] ?? "seo";
    setFormat(targetFormat);
    setGeneratorMode("advanced");
    setTopic(cleanTitle);
    setKeywords(uniqueText([item.primaryKeyword, ...item.lsi]).join(", "));
    setLength(defaultLengthByFormat[targetFormat]);
    setCustomLength(false);
    setAccent([
      useBrand && item.intent !== "Информационный"
        ? `Цель материала: продвигать конкретное предложение бренда ${effectiveBrand.name}; не заменять его общей инструкцией по выбору категории.`
        : "Цель материала: дать самостоятельный экспертный ответ по теме без подмены предмета.",
      `Коммуникационная задача: ${item.objective}`,
      `Редакционный ракурс: ${item.angle}`,
      "Использовать структуру контент‑плана как обязательные редакционные ориентиры.",
      ...structureLines,
      item.cta ? `Желаемый следующий шаг: ${item.cta}` : "",
      item.evidenceNeeded.length ? `Проверить фактуру перед публикацией: ${item.evidenceNeeded.join("; ")}` : "",
      `Комментарий пользователя: Целевая аудитория — ${item.audience}`,
    ].filter(Boolean).join("\n"));
    setGenerationError("");
    setGenerationMode("example");
    setGenerationCoverage(null);
    updateContentPlanStatus(item.id, "В работе");
    window.setTimeout(() => document.getElementById("generator")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    showToast("Тема, ключи и структура переданы в генератор");
  }

  function exportContentPlan() {
    if (!contentPlanResult.items.length) {
      showToast("Сначала соберите контент‑план");
      return;
    }
    const safeCell = (value: string) => {
      const protectedValue = /^[=+@-]/.test(value.trim()) ? `'${value}` : value;
      return `"${protectedValue.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["№", "Статус", "Тема", "Формат", "Кластер", "Интент", "Этап", "Приоритет", "Ракурс", "Цель", "Основной запрос", "Поддерживающая семантика", "Аудитория", "SEO‑заголовок", "Метаописание", "Структура", "CTA", "Фактура для проверки", "Источники"],
      ...contentPlanResult.items.map((item, index) => [
        String(index + 1), item.status, item.title, item.format, item.cluster, item.intent, item.stage, item.priority,
        item.angle, item.objective, item.primaryKeyword, item.lsi.join("; "), item.audience, item.metaTitle, item.metaDescription,
        item.structure.join("; "), item.cta, item.evidenceNeeded.join("; "), item.sources.join("; "),
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => safeCell(String(cell))).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "klio-content-plan.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Контент‑план экспортирован в CSV");
  }

  async function generate() {
    if (aiConnection !== "connected") {
      setGenerationError("ИИ не подключён. Демонстрационные статьи отключены, чтобы тема не подменялась шаблонным текстом.");
      return;
    }
    if (!topic.trim()) {
      setGenerationError("Укажите тему материала.");
      return;
    }
    setBusyStep(0);
    setBusy(true);
    setGenerationError("");
    try {
      const response = await requestGeneratedMaterial({
        format,
        topic,
        keywords,
        tone,
        length,
        accent,
        useBrand: useBrand && generatorUseBrand,
        useSemantics: generatorUseSemantics,
        useCompetitors: generatorUseCompetitors,
      });
      applyGeneratedMaterial(response.material, response.mode, response.coverage);
      showToast("Материал создан КЛИО");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Не удалось сформировать материал.");
    } finally {
      setBusy(false);
    }
  }

  async function generateQuick() {
    if (aiConnection !== "connected") {
      setQuickError("ИИ не подключён. Быстрый режим недоступен, пока не подключён ключ на сервере.");
      return;
    }
    if (quickPrompt.trim().split(/\s+/).filter(Boolean).length < 4) {
      setQuickError("Опишите задачу чуть подробнее — тему, бренд или сайт и что нужно написать.");
      return;
    }
    setQuickBusy(true);
    setQuickError("");
    try {
      const response = await fetch("/api/generate/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: quickPrompt, brandId: activeBrandId || undefined }),
      });
      const payload = await safeJson(response) as {
        error?: string;
        mode?: "ai";
        material?: GeneratedMaterial;
        format?: Format;
        tone?: string;
        targetLength?: number;
        usage?: { account?: WorkspaceAccount; archive?: GenerationArchiveItem } | null;
      };
      if (!response.ok || !payload.material) throw new Error(payload.error || "Не удалось сформировать материал.");
      if (payload.usage?.account) setWorkspaceAccount(payload.usage.account);
      if (payload.usage?.archive) setWorkspaceHistory((current) => [payload.usage!.archive!, ...current.filter((item) => item.id !== payload.usage!.archive!.id)].slice(0, 60));
      if (payload.format && formats.some((item) => item.id === payload.format)) setFormat(payload.format);
      if (payload.tone) setTone(payload.tone);
      setTopic(quickPrompt.trim().slice(0, 300));
      // Быстрый режим не показывает и не отправляет ни объём, ни ключи —
      // без этого объём/SEO‑виджеты справа сравнивали бы результат с тем,
      // что осталось от предыдущей работы в «Эксперте», а не с тем, что
      // реально попросили в свободном поле.
      if (payload.targetLength && payload.targetLength >= 30 && payload.targetLength <= 4000) {
        setLength(Math.round(payload.targetLength));
        setCustomLength(true);
      }
      setKeywords("");
      if (payload.mode !== "ai") throw new Error("Материал не получен от AI‑редакции.");
      applyGeneratedMaterial(payload.material, "ai", null);
      showToast("Материал создан КЛИО по вашему запросу");
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : "Не удалось сформировать материал.");
    } finally {
      setQuickBusy(false);
    }
  }

  function copyResult() {
    navigator.clipboard?.writeText(`${title}\n\n${body}`);
    showToast("Текст скопирован без служебного комментария");
  }

  function clearGenerationResultFields() {
    setTitle("");
    setBody("");
    setMetaTitle("");
    setMetaDescription("");
    setEditorNote("");
    setGenerationMode("example");
    setGenerationCoverage(null);
    setMetricsVisible(false);
  }

  function clearGeneratedResult() {
    clearGenerationResultFields();
    showToast("Поле результата очищено");
  }

  // Nothing here persists across a real reload (no localStorage) — but a
  // long workspace session never reloads, so a leftover topic/keywords
  // from an earlier test can sit in the brief and quietly bleed into the
  // next generation if a field is forgotten. One button, full reset.
  function resetGeneratorBrief() {
    setTopic("");
    setKeywords("");
    setAccent("");
    setTone("Экспертный");
    setLength(defaultLengthByFormat[format]);
    setCustomLength(false);
    setQuickPrompt("");
    setQuickError("");
    setGenerationError("");
    clearGenerationResultFields();
    showToast("Бриф очищен — можно начинать новую тему");
  }

  async function adaptText() {
    if (aiConnection !== "connected") {
      setAdaptationError("ИИ не подключён. Редакторы КЛИО не запускаются в тестовом режиме, чтобы не искажать исходный материал.");
      return;
    }
    if (adaptationSourceWords < 30) {
      setAdaptationError("Добавьте исходный текст объёмом не менее 30 слов.");
      return;
    }
    setAdaptationBusy(true);
    setAdaptationError("");
    try {
      const response = await fetch("/api/adapt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText: adaptationSource,
          goal: adaptationGoal,
          tone: adaptationTone,
          keywords: adaptationKeywords,
          instructions: adaptationInstructions,
          brand: effectiveBrand,
          useBrand,
        }),
      });
      const payload = await safeJson(response) as {
        error?: string;
        mode?: "ai";
        material?: AdaptedMaterial;
        usage?: { account?: WorkspaceAccount } | null;
      };
      if (!response.ok || !payload.material) throw new Error(payload.error || "Не удалось адаптировать текст.");
      setAdaptationResult(payload.material);
      if (payload.mode !== "ai") throw new Error("Материал не получен от редактора КЛИО.");
      if (payload.usage?.account) setWorkspaceAccount(payload.usage.account);
      setAdaptationMode("ai");
      showToast(`${activeAdaptationPlan.title} завершил редактуру`);
    } catch (error) {
      setAdaptationError(error instanceof Error ? error.message : "Не удалось адаптировать текст.");
    } finally {
      setAdaptationBusy(false);
    }
  }

  function copyAdaptation() {
    if (!adaptationResult) return;
    navigator.clipboard?.writeText(`${adaptationResult.title}\n\n${adaptationResult.body}`);
    showToast("Адаптированная версия скопирована");
  }

  function choosePlan(name: string) {
    showToast(`Выбран тариф «${name}»`);
    window.location.assign("/workspace");
  }

  function openModule(number: string) {
    if (number === "01") {
      window.location.assign("/workspace#brand-profile");
      return;
    }
    if (number === "02") {
      window.location.assign("/workspace#semantics");
      return;
    }
    if (number === "03") {
      window.location.assign("/workspace#competitors");
      return;
    }
    if (number === "04") {
      window.location.assign("/workspace#generator");
      return;
    }
    if (number === "05") {
      window.location.assign("/workspace#content-plan");
      return;
    }
    if (number === "06") {
      window.location.assign("/workspace#adaptation");
      return;
    }
    showToast("Откройте рабочее пространство для тестирования модуля");
  }

  // The "Материалы" header button just toggled historyOpen with no visual
  // feedback beyond that — from anywhere scrolled away from the top of the
  // page, the section that appears reads as "the button did nothing".
  // Bring it into view whenever it opens.
  useEffect(() => {
    if (!historyOpen) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("history")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [historyOpen]);

  if (workspace) {
    // ±15% matches the tolerance the generator itself already accepts as a
    // finished result server-side (see app/api/generate/route.ts) — the UI
    // must never flag a word count the backend already considered fine.
    const withinTarget = words >= Math.floor(length * 0.85) && words <= Math.ceil(length * 1.15);
    const targetChecked = generationMode !== "example";

    if (workspaceDataError && !activeBrandId) {
      return <main className="workspace-shell workspace-loading is-error"><Brand/><div><h1>Кабинет временно недоступен</h1><p>{workspaceDataError}</p><button className="button primary" type="button" onClick={() => window.location.reload()}>Повторить</button></div></main>;
    }

    return <main className="workspace-shell">
      <header className="workspace-header">
        <Link className="wordmark" href="/" aria-label="КЛИО — вернуться на сайт"><Brand/></Link>
        <div className="workspace-header-actions">
          <Link href="/">На главную</Link>
          <button className="workspace-history-button" type="button" onClick={() => setHistoryOpen((value) => !value)}><span>Материалы</span><b>{activeMaterialCount}</b></button>
          <div className={`account-menu ${accountMenuOpen ? "is-open" : ""}`} ref={accountMenuRef}>
            <button type="button" className="workspace-account" onClick={() => setAccountMenuOpen((value) => !value)} aria-haspopup="menu" aria-expanded={accountMenuOpen}>
              <i>{nameInitials(workspaceUserName)}</i><b>{workspaceUserName}</b><small>{workspaceAccount.planName} · 1 пользователь</small><em>⌄</em>
            </button>
            {accountMenuOpen && <div className="account-menu-list" role="menu">
              <Link href="/account" role="menuitem">Личный кабинет</Link>
              <button type="button" role="menuitem" onClick={() => void signOutOfWorkspace()}>Выйти</button>
            </div>}
          </div>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="workspace-sidebar">
          <div className="workspace-project brand-project-switcher">
            <span>Активный бренд</span>
            <div className={`brand-menu ${brandMenuOpen ? "is-open" : ""}`} ref={brandPickerRef}>
              <button className="brand-menu-trigger" type="button" onClick={() => setBrandMenuOpen((value) => !value)} disabled={brandSwitchBusy} aria-haspopup="listbox" aria-expanded={brandMenuOpen}>
                <i>{(activeWorkspaceBrand?.name || brand.name || "К").trim().charAt(0).toLocaleUpperCase("ru-RU")}</i>
                <span><b>{activeWorkspaceBrand?.name || brand.name || "Выберите бренд"}</b><small>{activeWorkspaceBrand?.website || "Профиль компании"}</small></span>
                <em>⌄</em>
              </button>
              {brandMenuOpen && <div className="brand-menu-list" role="listbox" aria-label="Выбор бренда">
                {workspaceBrands.map((item) => <button type="button" role="option" aria-selected={item.id === activeBrandId} className={item.id === activeBrandId ? "active" : ""} onClick={() => void switchWorkspaceBrand(item.id)} key={item.id}>
                  <i>{item.name.trim().charAt(0).toLocaleUpperCase("ru-RU") || "К"}</i>
                  <span><b>{item.name}</b><small>{item.website || "Профиль без сайта"}</small></span>
                  <em>{item.id === activeBrandId ? "✓" : ""}</em>
                </button>)}
              </div>}
            </div>
            <small>{workspaceBrands.length} из {workspaceAccount.brandLimit} брендов · данные раздельны</small>
            <button type="button" onClick={() => setBrandCreatorOpen((value) => !value)} disabled={workspaceBrands.length >= workspaceAccount.brandLimit || brandSwitchBusy}>+ Добавить бренд</button>
            {brandCreatorOpen && <div className="brand-create-form"><input value={newBrandName} onChange={(event) => setNewBrandName(event.target.value)} placeholder="Название бренда" autoFocus autoComplete="off"/><button type="button" onClick={() => void createWorkspaceBrand()}>Создать</button></div>}
          </div>
          <nav aria-label="Рабочие модули">
            <a href="#brand-profile" onClick={() => setBrandOpen(true)}><i>+</i><span><b>Профиль бренда</b><small>по желанию</small></span></a>
            <a href="#generator"><i>01</i><span><b>Генерировать материал</b><small>быстрый старт</small></span></a>
            <a href="#content-plan" onClick={() => setContentPlanOpen(true)}><i>+</i><span><b>Контент‑план</b><small>самостоятельный инструмент</small></span></a>
            <a href="#adaptation" onClick={() => setAdaptationOpen(true)}><i>+</i><span><b>Редакторы КЛИО</b><small>12 режимов для готового текста</small></span></a>
            <a href="#semantics" onClick={() => setSemanticOpen(true)}><i>+</i><span><b>Семантика</b><small>самостоятельно или в бриф</small></span></a>
            <a href="#competitors" onClick={() => setCompetitorOpen(true)}><i>+</i><span><b>Конкуренты</b><small>По желанию</small></span></a>
          </nav>
          <div className="workspace-stage workspace-quota-stage"><span>Ваш тариф</span><b>{workspaceAccount.planName}</b><div className="workspace-quota-list"><p><span>Материалы</span><em>{workspaceAccount.generationsRemaining} / {workspaceAccount.generationLimit}</em><i><u style={{ width: `${generationProgress}%` }}/></i></p><p><span>Исследования</span><em>{workspaceAccount.researchRemaining} / {workspaceAccount.researchLimit}</em><i><u style={{ width: `${researchProgress}%` }}/></i></p><p><span>AI‑редактура</span><em>{workspaceAccount.editorActionsRemaining} / {workspaceAccount.editorActionLimit}</em><i><u style={{ width: `${editorProgress}%` }}/></i></p></div></div>
        </aside>

        <section className="workspace-content">
          <div className="workspace-heading">
            <div><p>Рабочее пространство / выпуск 01</p><h1>Редакционная система</h1><span>Здесь находятся инструменты КЛИО. Маркетинговые разделы остались на публичной странице.</span></div>
            <div className={`workspace-status ${workspaceDataError ? "has-error" : ""}`}><i/><span><b>{workspaceDataError ? "Ошибка сохранения" : !workspaceReady ? "Загружаем кабинет" : workspaceSaving ? "Сохраняем изменения" : "Все изменения сохранены"}</b><small>{workspaceDataError || (!workspaceReady ? "Генератор уже доступен — данные брендов появятся через мгновение" : `${activeWorkspaceBrand?.name || brand.name} · защищённое хранилище кабинета`)}</small></span></div>
          </div>


          {historyOpen && <section className="workspace-history" id="history">
            <div className="workspace-history-head"><div><span>Кабинет бренда · {activeWorkspaceBrand?.name || brand.name}</span><h2>Материалы</h2><p>Здесь хранятся только статьи, планы и исследования текущего бренда. Сохранённый результат можно открыть в своём модуле и продолжить работу.</p></div><button type="button" onClick={() => setHistoryOpen(false)} aria-label="Закрыть материалы"><span>Закрыть</span><i aria-hidden="true">×</i></button></div>
            {activeMaterialCount > 0 && <div className="workspace-history-toolbar">
              <div className="workspace-history-filters" role="group" aria-label="Фильтр материалов по типу">
                {materialsFilterOptions.map((option) => <button type="button" className={materialsFilter === option.id ? "active" : ""} aria-pressed={materialsFilter === option.id} onClick={() => setMaterialsFilter(option.id)} key={option.id}><span>{option.label}</span><b>{option.count}</b></button>)}
              </div>
              <ModuleSelect label="Период" value={materialsDateRange} options={MATERIALS_DATE_RANGE_OPTIONS} onChange={(value) => setMaterialsDateRange(value as MaterialsDateRange)}/>
            </div>}
            {visibleBrandArticles.length || visibleBrandSavedMaterials.length ? <div className="workspace-history-list">{visibleBrandArticles.map((item) => {
              const formatLabel = formats.find((candidate) => candidate.id === item.format)?.label || item.format;
              return <article className="material-card material-article" key={item.id}><div><span>{formatLabel}</span><small>{archiveDate(item.createdAt)}</small></div><h3>{item.title}</h3><p>{item.topic}</p><footer><span>Статья или текст</span><div><button type="button" className="material-delete" onClick={() => void deleteArchiveItem(item)} aria-label="Удалить материал">Удалить</button><button type="button" onClick={() => openArchiveItem(item)}>В редактор <Icon name="arrow"/></button></div></footer></article>;
            })}{visibleBrandSavedMaterials.map((item) => {
              const typeLabel = item.type === "content_plan" ? "Контент‑план" : item.type === "semantics" ? "Семантика" : "Анализ конкурентов";
              return <article className={`material-card material-${item.type}`} key={item.id}><div><span>{typeLabel}</span><small>{archiveDate(item.createdAt)} · версия {item.versionNumber}</small></div><h3>{item.title}</h3><p>{item.status}</p><footer><span>Сохранённый снимок</span><div><button type="button" className="material-delete" onClick={() => void deleteSavedMaterial(item)} aria-label="Удалить материал">Удалить</button><button type="button" className="material-export" onClick={() => exportSavedMaterial(item)}>Экспорт</button><button type="button" onClick={() => openSavedMaterial(item)}>В модуль <Icon name="arrow"/></button></div></footer></article>;
            })}</div> : <div className="workspace-history-empty"><i>Аа</i><div><h3>{activeMaterialCount > 0 ? "Нет материалов за выбранный период" : "У этого бренда пока нет материалов"}</h3><p>{activeMaterialCount > 0 ? "Попробуйте выбрать другой период или фильтр." : "Сгенерированные тексты появятся здесь автоматически. Семантику, анализ конкурентов и контент‑планы можно зафиксировать кнопкой «Сохранить в материалы»."}</p></div></div>}
          </section>}

          {archiveEditorItem && <div className="archive-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeArchiveEditor(); }}>
            <section className="archive-editor-modal" role="dialog" aria-modal="true" aria-labelledby="archive-editor-title">
              <div className="archive-editor-head">
                <div><span>Материалы / редактор КЛИО</span><h2 id="archive-editor-title">{formats.find((item) => item.id === archiveEditorItem.format)?.label || archiveEditorItem.format}</h2><p>Работайте с сохранённой статьёй отдельно: текущий черновик генератора не изменяется.</p></div>
                <div className="archive-editor-head-actions"><span className={archiveEditorDirty ? "is-dirty" : ""}>{archiveEditorDirty ? "Есть несохранённые правки" : "Версия сохранена"}</span><button type="button" onClick={closeArchiveEditor} aria-label="Закрыть редактор">×</button></div>
              </div>
              <div className="archive-editor-meta">
                <span><b>Исходная тема</b>{archiveEditorItem.topic}</span>
                <span><b>Бренд</b>{(archiveEditorItem.brandId ? workspaceBrands.find((item) => item.id === archiveEditorItem.brandId)?.name : "") || "Без привязки"}</span>
                <span><b>Создан</b>{archiveDate(archiveEditorItem.createdAt)}</span>
                <span><b>Лимит</b>AI‑доработка расходует 1 редакторское действие</span>
              </div>
              <div className="archive-editor-grid">
                <article className="archive-editor-document">
                  <label><span>Заголовок материала</span><AutoTextarea className="archive-editor-title" rows={1} value={archiveEditorItem.title} onChange={(event) => setArchiveEditorItem((current) => current ? { ...current, title: event.target.value } : current)}/></label>
                  <label><span>Текст материала</span><AutoTextarea className="archive-editor-body" rows={16} value={archiveEditorItem.body} onChange={(event) => setArchiveEditorItem((current) => current ? { ...current, body: event.target.value } : current)}/></label>
                  <div className="archive-editor-seo">
                    <label><span className="seo-field-label"><b>SEO‑заголовок</b><button type="button" onClick={() => copyPlainText(archiveEditorItem.metaTitle, "SEO‑заголовок")}><Icon name="copy"/> Копировать</button></span><AutoTextarea rows={1} value={archiveEditorItem.metaTitle} onChange={(event) => setArchiveEditorItem((current) => current ? { ...current, metaTitle: event.target.value } : current)}/></label>
                    <label><span className="seo-field-label"><b>Метаописание</b><button type="button" onClick={() => copyPlainText(archiveEditorItem.metaDescription, "Метаописание")}><Icon name="copy"/> Копировать</button></span><AutoTextarea rows={2} value={archiveEditorItem.metaDescription} onChange={(event) => setArchiveEditorItem((current) => current ? { ...current, metaDescription: event.target.value } : current)}/></label>
                  </div>
                  <label className="archive-editor-comment"><span>Редакторский комментарий</span><AutoTextarea rows={3} value={archiveEditorItem.editorialComment} onChange={(event) => setArchiveEditorItem((current) => current ? { ...current, editorialComment: event.target.value } : current)}/><small>Служебное поле не копируется вместе с публикацией.</small></label>
                  {archiveEditorChanges.length > 0 && <div className="archive-editor-change-log"><span>Что изменил режим КЛИО</span><div>{archiveEditorChanges.map((item) => <p key={item}><i>✓</i>{item}</p>)}</div></div>}
                  {archiveEditorError && <p className="generation-error" role="alert">{archiveEditorError}</p>}
                  <div className="archive-editor-actions">
                    <button type="button" onClick={copyArchiveItem}><Icon name="copy"/> Копировать текст</button>
                    <button type="button" onClick={restoreArchiveOriginal} disabled={!archiveEditorDirty || archiveEditorSaving || archiveEditorBusy}>Вернуть сохранённую</button>
                    <button className="button ghost" type="button" onClick={() => void saveArchiveItem("copy")} disabled={archiveEditorSaving || archiveEditorBusy}>{archiveEditorSaving ? "Сохраняем…" : "Сохранить как копию"}</button>
                    <button className="button primary" type="button" onClick={() => void saveArchiveItem("update")} disabled={archiveEditorSaving || archiveEditorBusy || !archiveEditorDirty}>{archiveEditorSaving ? "Сохраняем…" : "Пересохранить"}</button>
                  </div>
                </article>
                <aside className="archive-transform-panel">
                  <span>Редакторы КЛИО</span><h3>{activeArchivePlan.title}</h3><p>{activeArchivePlan.result}. Все режимы используют сохранённый материал как единственный источник фактов.</p>
                  <div className="archive-transform-tools">{adaptationGoals.map((item) => {
                    const active = archiveTransformGoal === item.id;
                    return <article className={active ? "active" : ""} key={item.id}>
                      <button type="button" className={active ? "active" : ""} onClick={() => setArchiveTransformGoal(item.id)} aria-expanded={active}><i>{active ? "✓" : ""}</i><span><b>{item.label}</b><small>{item.detail}</small></span></button>
                      {active && <div className="archive-transform-inline"><span>Сценарий режима</span><b>{ADAPTATION_PLANS[item.id].result}</b><ol>{ADAPTATION_PLANS[item.id].steps.map((step) => <li key={step}>{step}</li>)}</ol></div>}
                    </article>;
                  })}</div>
                  <div className="archive-tone-picker"><span>Интонация новой версии</span><div>{styles.map((item) => <button type="button" className={archiveEditorTone === item ? "active" : ""} onClick={() => setArchiveEditorTone(item)} key={item}>{item}</button>)}</div></div>
                  <button className={`button primary large archive-ai-submit ${archiveEditorBusy ? "is-busy" : ""}`} type="button" onClick={() => void runArchiveEditor()} disabled={archiveEditorBusy || archiveEditorSaving || aiConnection !== "connected" || workspaceAccount.editorActionsRemaining <= 0}><Icon name="spark"/>{archiveEditorBusy ? "КЛИО редактирует…" : aiConnection !== "connected" ? "Сначала подключите ИИ" : workspaceAccount.editorActionsRemaining <= 0 ? "Лимит AI‑редактуры исчерпан" : `Запустить «${activeArchivePlan.title}»`}</button>
                  <small>Один запуск режима расходует одно редакторское действие. Ручные правки, копирование и сохранение бесплатны.</small>
                </aside>
              </div>
            </section>
          </div>}

          <div className="workspace-quickstart">
          <div className="mvp-flow" aria-label="Простой и расширенный режимы работы">
            <div className="mvp-flow-main">
              <span>Начните без лишних этапов</span>
              <div className="mvp-flow-steps">
                <div className="mvp-flow-step"><i>01</i><span><b>Тема и ключи</b><small>этого достаточно для старта</small></span></div>
                <i className="mvp-flow-arrow" aria-hidden="true">→</i>
                <div className="mvp-flow-step"><i>02</i><span><b>Готовый материал</b><small>сразу в генераторе</small></span></div>
              </div>
            </div>
            <div className="mvp-flow-extra">
              <div className="mvp-flow-plan"><i>+</i><span><b>Нужна глубина?</b><small>откройте любой инструмент ниже</small></span></div>
              <div className="mvp-flow-optional"><i>↗</i><span><b>Инструменты автономны</b><small>результат можно не передавать в генератор</small></span></div>
              <div className="mvp-flow-alternative"><i>Аа</i><span><b>Есть готовый текст?</b><small>откройте редакторы КЛИО</small></span></div>
            </div>
          </div>

          <section className={`brand-profile ${brandOpen ? "is-open" : ""}`} id="brand-profile">
            <div className="brand-profile-head">
              <div><span>Модуль 01</span><h3>Профиль бренда</h3><p>КЛИО использует эти данные как редакционную память — факты и интонация переходят в каждый новый материал.</p></div>
              <div className="brand-profile-actions">
                <label className="brand-switch"><input type="checkbox" checked={useBrand} onChange={(event) => { setUseBrand(event.target.checked); setSemanticNeedsRefresh(true); setContentPlanNeedsRefresh(true); }}/><span/><b>{useBrand ? "Профиль активен" : "Профиль отключён"}</b></label>
                <button type="button" className="profile-toggle" onClick={() => setBrandOpen((value) => !value)} aria-expanded={brandOpen}>{brandOpen ? "Свернуть" : "Открыть профиль"} <i>{brandOpen ? "−" : "+"}</i></button>
              </div>
            </div>
            {brandOpen && <div className="brand-profile-body">
              <div className="profile-mode-bar">
                <div><span>Режим настройки</span><b>{profileMode === "quick" ? "Быстрый старт" : "Экспертный"}</b><small>{profileMode === "quick" ? "КЛИО готовит голос и правила площадок по основе бренда" : "Все формулировки доступны для полной ручной настройки"}</small></div>
                <div className="profile-mode-switch" role="radiogroup" aria-label="Режим настройки профиля">
                  <button type="button" className={profileMode === "quick" ? "active" : ""} onClick={() => changeProfileMode("quick")} role="radio" aria-checked={profileMode === "quick"}><i>✦</i><span><b>Быстрый старт</b><small>с рекомендациями</small></span></button>
                  <button type="button" className={profileMode === "expert" ? "active" : ""} onClick={() => changeProfileMode("expert")} role="radio" aria-checked={profileMode === "expert"}><i>↗</i><span><b>Экспертный</b><small>ручная настройка</small></span></button>
                </div>
              </div>

              <div className="brand-profile-overview">
                <div className="brand-score" style={{ "--profile-score": `${brandScore}%` } as CSSProperties}>
                  <div><b>{brandScore}</b><span>%</span></div>
                  <p><strong>Готовность профиля</strong><small>{brandScore === 100 ? "Данных достаточно для теста" : "Заполните недостающие разделы"}</small></p>
                </div>
                <div className="brand-checklist">
                  {brandChecklist.map((item) => <div className={item.complete ? "is-complete" : ""} key={item.label}><i>{item.complete ? "✓" : "·"}</i><span><b>{item.label}</b><small>{item.detail}</small></span></div>)}
                </div>
              </div>

              <div className="brand-tab-navigation">
                <div className="brand-tab-navigation-head"><span>Разделы профиля</span><small>Нажимайте на кнопки, чтобы переключать настройки</small></div>
                <div className="brand-tabs" role="tablist" aria-label="Переключение разделов профиля бренда">
                  <button type="button" className={brandTab === "foundation" ? "active" : ""} onClick={() => setBrandTab("foundation")} role="tab" aria-selected={brandTab === "foundation"}><i>01</i><b>Основа бренда</b><span>›</span></button>
                  <button type="button" className={brandTab === "voice" ? "active" : ""} onClick={() => setBrandTab("voice")} role="tab" aria-selected={brandTab === "voice"}><i>02</i><b>Голос и ограничения</b><span>›</span></button>
                  <button type="button" className={brandTab === "formats" ? "active" : ""} onClick={() => setBrandTab("formats")} role="tab" aria-selected={brandTab === "formats"}><i>03</i><b>Правила форматов</b><span>›</span></button>
                </div>
              </div>

              {brandTab === "foundation" && <div className="brand-field-group" role="tabpanel">
                <div className="brand-group-heading"><span>Основа бренда</span><p>Факты, которые определяют, о ком и для кого говорит каждый материал.</p></div>
                <div className="brand-fields">
                  <label>Компания<input value={brand.name} onChange={(event) => updateBrand("name", event.target.value)} autoComplete="off"/><small>Полное название, которое можно использовать в публикации.</small></label>
                  <label>Сайт<input value={brand.website} onChange={(event) => updateBrand("website", event.target.value)} autoComplete="off"/><small>КЛИО читает открытую страницу при сборе семантики и генерации; недоступные сведения не додумываются.</small></label>
                  <label className="wide">О компании<AutoTextarea rows={3} value={brand.description} onChange={(event) => updateBrand("description", event.target.value)}/><small>Короткая фактическая справка: сфера, география, услуги и масштаб.</small></label>
                  <label className="wide">Позиционирование<AutoTextarea rows={3} value={brand.positioning} onChange={(event) => updateBrand("positioning", event.target.value)}/><small>Какое место бренд хочет занимать в сознании аудитории — не рекламный слоган, а редакционный ориентир.</small></label>
                  <label>Основная аудитория<AutoTextarea rows={4} value={brand.audience} onChange={(event) => updateBrand("audience", event.target.value)}/><small>Кто читатель, с какой задачей и на каком уровне понимания темы.</small></label>
                  <label>Факты и преимущества<AutoTextarea rows={4} value={brand.advantages} onChange={(event) => updateBrand("advantages", event.target.value)}/><small>Только подтверждённые особенности, на которые можно опираться в тексте.</small></label>
                </div>
              </div>}

              {brandTab === "voice" && <div className="brand-field-group" role="tabpanel">
                <div className="brand-group-heading"><span>Редакционный голос</span><p>Здесь задаётся не один «тон», а устойчивый характер коммуникации.</p></div>
                {!foundationReady ? <div className="profile-foundation-warning"><i>01</i><div><b>Сначала заполните основу бренда</b><p>Для рекомендаций нужны описание, позиционирование, аудитория и подтверждённые преимущества.</p></div><button type="button" onClick={() => setBrandTab("foundation")}>Перейти к основе</button></div> : profileMode === "quick" ? <>
                  <div className="profile-ai-note"><span><i>✦</i> Предзаполнено КЛИО</span><p>Формулировки собраны из основы бренда и автоматически используются в генераторе. Перед сохранением их можно открыть и отредактировать.</p></div>
                  <div className="profile-recommendation-grid">
                    <article><span>Интонация</span><p>{voiceRecommendations.voice}</p></article>
                    <article><span>Безопасность</span><p>{voiceRecommendations.restrictions}</p></article>
                    <article><span>Фирменная подпись</span><p>{voiceRecommendations.signature}</p></article>
                    <article><span>Стоп-слова</span><p>{voiceRecommendations.prohibited}</p></article>
                  </div>
                  <div className="profile-recommendation-footer"><small>Рекомендации не являются закрытым шаблоном — их можно полностью изменить.</small><button className="recommendation-edit-button" type="button" onClick={() => changeProfileMode("expert")}><Icon name="edit"/> Изменить рекомендации</button></div>
                </> : <>
                  <div className="profile-assistant-row"><div><span>Умное предзаполнение</span><p>Можно взять рекомендации из основы, а затем скорректировать каждое поле.</p></div><button type="button" onClick={applyVoiceRecommendations}>Предзаполнить поля</button></div>
                  <div className="brand-fields">
                    <label className="wide">Голос бренда<AutoTextarea rows={4} value={brand.voice} onChange={(event) => updateBrand("voice", event.target.value)}/><small>Интонация, сложность языка, длина фраз и степень эмоциональности.</small></label>
                    <label className="wide">Фирменная подпись<AutoTextarea rows={2} value={brand.signature} onChange={(event) => updateBrand("signature", event.target.value)}/><small>Финальная формулировка для постов; КЛИО добавляет её только там, где она уместна.</small></label>
                    <label>Ограничения<AutoTextarea rows={4} value={brand.restrictions} onChange={(event) => updateBrand("restrictions", event.target.value)}/><small>Что нельзя обещать, утверждать или придумывать без проверки.</small></label>
                    <label>Стоп-слова и клише<AutoTextarea rows={4} value={brand.prohibited} onChange={(event) => updateBrand("prohibited", event.target.value)}/><small>Разделяйте слова и выражения точкой с запятой — они попадут в автоматическую проверку.</small></label>
                  </div>
                </>}
              </div>}

              {brandTab === "formats" && <div className="brand-field-group" role="tabpanel">
                <div className="brand-group-heading"><span>Правила по площадкам</span><p>Один бренд говорит узнаваемо, но не одинаково в статье, посте, рекламе и на сайте.</p></div>
                {!foundationReady ? <div className="profile-foundation-warning"><i>01</i><div><b>Правила появятся после заполнения основы</b><p>КЛИО подготовит четыре отдельных сценария с учётом аудитории, фактов и позиционирования.</p></div><button type="button" onClick={() => setBrandTab("foundation")}>Заполнить основу</button></div> : profileMode === "quick" ? <>
                  <div className="profile-ai-note"><span><i>✦</i> Четыре готовых сценария</span><p>КЛИО уже адаптировала единый голос под разные задачи. Эти правила автоматически передаются в выбранный формат генератора.</p></div>
                  <div className="format-recommendation-grid">
                    <article><div><i>SEO</i><span>500–4 000 слов</span></div><h4>SEO‑статья</h4><p>{formatRecommendations.seoRules}</p></article>
                    <article><div><i>SMM</i><span>80–500 слов</span></div><h4>Социальные сети</h4><p>{formatRecommendations.socialRules}</p></article>
                    <article><div><i>ADS</i><span>50–300 слов</span></div><h4>Рекламный текст</h4><p>{formatRecommendations.adsRules}</p></article>
                    <article><div><i>WEB</i><span>300–1 800 слов</span></div><h4>Текст для сайта</h4><p>{formatRecommendations.landingRules}</p></article>
                  </div>
                  <div className="profile-recommendation-footer"><small>Новичку достаточно проверить предложения; специалист может открыть все поля.</small><button className="recommendation-edit-button" type="button" onClick={() => changeProfileMode("expert")}><Icon name="edit"/> Изменить правила</button></div>
                </> : <>
                  <div className="profile-assistant-row"><div><span>Умное предзаполнение</span><p>КЛИО подготовит примеры для всех площадок; после этого каждое правило можно изменить.</p></div><button type="button" onClick={applyFormatRecommendations}>Подготовить 4 правила</button></div>
                  <div className="brand-fields format-rule-fields">
                    <label>SEO-статья<AutoTextarea rows={5} value={brand.seoRules} onChange={(event) => updateBrand("seoRules", event.target.value)}/><small>Обычно 500–4 000 слов: глубина, структура, ключи и требования к фактам.</small></label>
                    <label>Социальные сети<AutoTextarea rows={5} value={brand.socialRules} onChange={(event) => updateBrand("socialRules", event.target.value)}/><small>Обычно 80–500 слов: подача от лица бренда, ритм, финал и подпись.</small></label>
                    <label>Рекламный текст<AutoTextarea rows={5} value={brand.adsRules} onChange={(event) => updateBrand("adsRules", event.target.value)}/><small>Обычно 50–300 слов: конкретная выгода, допустимый призыв и уровень срочности.</small></label>
                    <label>Текст для сайта<AutoTextarea rows={5} value={brand.landingRules} onChange={(event) => updateBrand("landingRules", event.target.value)}/><small>Обычно 300–1 800 слов: логика страницы, доказательства и следующий шаг.</small></label>
                  </div>
                </>}
              </div>}

              <div className="brand-profile-footer"><p><i className={brandSaved ? "saved" : ""}/>{brandSaved ? "Профиль и данные бренда сохранены в кабинете" : "Есть несохранённые изменения"}</p><div><button type="button" onClick={restoreBrand}>Восстановить базовый профиль</button><button className="button primary" type="button" onClick={() => void saveBrand()}>Сохранить профиль</button></div></div>
            </div>}
          </section>
          </div>

          <section className={`workspace-module semantics-module ${semanticOpen ? "" : "tool-collapsed"}`} id="semantics">
            <div className="workspace-module-heading tool-heading"><div><span>Самостоятельный инструмент · по желанию</span><h2>Семантика и поисковый интент</h2></div><p>Соберите ключи отдельно или передайте выбранные фразы в генератор. Для быстрого материала этот этап можно пропустить.</p><button type="button" onClick={() => setSemanticOpen((value) => !value)} aria-expanded={semanticOpen}>{semanticOpen ? "Свернуть" : "Открыть инструмент"}<i>{semanticOpen ? "−" : "+"}</i></button></div>
            <div className="semantic-shell">
              <div className="semantic-search-card">
                <div className="semantic-search-head">
                  <div><span>Шаг 1 · исходные данные</span><h3>Что ищет ваш читатель?</h3><p>Сначала задайте тему и географию. Результаты появятся только после запуска анализа — до этого момента ничего не передаётся в генератор.</p></div>
                  <span className={`semantic-mode semantic-mode-${aiConnection === "connected" ? "ai" : "idle"}`}><i/>{aiConnection === "connected" ? "ИИ подключён" : aiConnection === "disconnected" ? "ИИ не подключён · генерация отключена" : "Проверяем AI‑подключение"}</span>
                </div>
                <div className="semantic-primary-query">
                  <label>
                    <span className="semantic-primary-label"><i>Главное поле</i><b>Основной запрос или тема</b></span>
                    <input value={semanticQuery} onChange={(event) => updateSemanticQuery(event.target.value)} placeholder="Например: санаторий для лечения остеохондроза" autoComplete="off" />
                    <small>Это единственный источник темы для текущего анализа. Генератор не может заменить или дополнить запрос скрыто.</small>
                  </label>
                </div>

                <div className={`semantic-geo-picker ${semanticGeoOpen ? "is-open" : ""}`} ref={geoPickerRef}>
                  <button
                    className="semantic-geo-trigger"
                    type="button"
                    aria-expanded={semanticGeoOpen}
                    aria-controls="semantic-geo-tree"
                    onClick={() => setSemanticGeoOpen((current) => !current)}
                  >
                    <span><i>География спроса</i><b>{semanticGeoSummary}</b><small>Округа, регионы и города можно выбирать одновременно</small></span>
                    <em>{selectedGeoScopes.length ? `${selectedGeoScopes.length} выбрано` : "Без ограничений"}<i>⌄</i></em>
                  </button>

                  {selectedGeoScopes.length > 0 && <div className="semantic-geo-chips" aria-label="Выбранная география">
                    {selectedGeoScopes.slice(0, 8).map((scope) => <button type="button" key={scope.key} onClick={() => removeSemanticGeoScope(scope)} title={`Убрать: ${scope.label}`}><span><b>{scope.label}</b><small>{scope.detail}</small></span><i>×</i></button>)}
                    {selectedGeoScopes.length > 8 && <span>+{selectedGeoScopes.length - 8}</span>}
                  </div>}

                  {semanticGeoOpen && <div className="semantic-geo-menu" id="semantic-geo-tree">
                    <div className="semantic-geo-menu-head">
                      <label><span>Найти территорию</span><input autoFocus value={semanticGeoSearch} onChange={(event) => setSemanticGeoSearch(event.target.value)} placeholder="Округ, регион или город" autoComplete="off"/></label>
                      <button type="button" onClick={clearSemanticGeo} disabled={!selectedGeoCityIds.size}>Сбросить выбор</button>
                    </div>
                    <div className="semantic-geo-tree" role="tree" aria-label="Округа, регионы и города России">
                      {visibleGeoTree.map((district) => {
                        const districtIds = idsForDistrict(district.name);
                        const districtState = geoSelectionState(selectedGeoCityIds, districtIds);
                        const districtExpanded = Boolean(semanticGeoSearch) || openGeoDistricts.includes(district.name);
                        return <section className="semantic-geo-district" key={district.name}>
                          <div className="semantic-geo-node district-node" role="treeitem" aria-expanded={districtExpanded} aria-selected={districtState.checked || districtState.mixed}>
                            <button type="button" className={`semantic-geo-checkbox ${districtState.checked ? "is-checked" : ""} ${districtState.mixed ? "is-mixed" : ""}`} role="checkbox" aria-checked={districtState.mixed ? "mixed" : districtState.checked} aria-label={`Выбрать ${district.name}`} onClick={() => updateSemanticGeo(districtIds)}><i>{districtState.mixed ? "−" : districtState.checked ? "✓" : ""}</i></button>
                            <button type="button" className="semantic-geo-node-label" onClick={() => toggleGeoDistrictOpen(district.name)}><span><b>{district.name}</b><small>{district.regions.length} регионов</small></span><i className={districtExpanded ? "is-expanded" : ""}>⌄</i></button>
                          </div>
                          {districtExpanded && <div className="semantic-geo-regions" role="group">
                            {district.regions.map((region) => {
                              const regionIds = idsForRegion(region.name);
                              const regionState = geoSelectionState(selectedGeoCityIds, regionIds);
                              const regionExpanded = Boolean(semanticGeoSearch) || openGeoRegions.includes(region.name);
                              return <div className="semantic-geo-region" key={region.name}>
                                <div className="semantic-geo-node region-node" role="treeitem" aria-expanded={regionExpanded} aria-selected={regionState.checked || regionState.mixed}>
                                  <button type="button" className={`semantic-geo-checkbox ${regionState.checked ? "is-checked" : ""} ${regionState.mixed ? "is-mixed" : ""}`} role="checkbox" aria-checked={regionState.mixed ? "mixed" : regionState.checked} aria-label={`Выбрать ${region.name}`} onClick={() => updateSemanticGeo(regionIds)}><i>{regionState.mixed ? "−" : regionState.checked ? "✓" : ""}</i></button>
                                  <button type="button" className="semantic-geo-node-label" onClick={() => toggleGeoRegionOpen(region.name)}><span><b>{region.name}</b><small>{region.cities.length} {region.cities.length === 1 ? "город" : region.cities.length < 5 ? "города" : "городов"}</small></span><i className={regionExpanded ? "is-expanded" : ""}>⌄</i></button>
                                </div>
                                {regionExpanded && <div className="semantic-geo-cities" role="group">
                                  {region.cities.map((city) => {
                                    const cityId = geoCityId(region.name, city);
                                    const checked = selectedGeoCityIds.has(cityId);
                                    return <button type="button" className={checked ? "is-checked" : ""} role="checkbox" aria-checked={checked} onClick={() => updateSemanticGeo([cityId])} key={cityId}><i>{checked ? "✓" : ""}</i><span>{city}</span></button>;
                                  })}
                                </div>}
                              </div>;
                            })}
                          </div>}
                        </section>;
                      })}
                      {!visibleGeoTree.length && <div className="semantic-geo-empty"><b>Ничего не найдено</b><span>Попробуйте другое название региона или города.</span></div>}
                    </div>
                    <div className="semantic-geo-menu-footer"><span><b>{selectedGeoCityIds.size}</b> городов входят в выбранный охват</span><button type="button" onClick={() => setSemanticGeoOpen(false)}>Готово</button></div>
                  </div>}
                  <div className="semantic-geo-summary"><span>Передаём в анализ</span><b>{semanticRegion}</b></div>
                </div>
                <div className={`semantic-analysis-action ${semanticNeedsRefresh ? "needs-refresh" : ""}`}>
                  <div><span>{semanticAnalysisReady ? "Анализ актуален" : semanticMode === "idle" ? "Шаг 2 · запуск анализа" : "Исходные данные изменены"}</span><b>{semanticQuery.trim() ? `Анализируем: «${semanticQuery.trim()}»` : "Введите основной запрос выше"}</b><small>{semanticAnalysisReady ? "Результат ниже относится только к текущей теме и выбранной географии." : `Будут использованы тема + география${useBrand ? " + профиль и открытая страница бренда" : " без профиля бренда"}.`}</small></div>
                  <button className={`button primary large ${semanticBusy ? "is-busy" : ""}`} type="button" onClick={analyzeSemantics} disabled={semanticBusy || !semanticQuery.trim() || aiConnection !== "connected" || workspaceAccount.researchRemaining <= 0}><Icon name="spark"/>{semanticBusy ? "Анализируем…" : aiConnection !== "connected" ? "Сначала подключите ИИ" : workspaceAccount.researchRemaining <= 0 ? "Лимит исследований исчерпан" : semanticMode === "idle" ? "Собрать семантику" : "Обновить семантику"}</button>
                </div>
                {semanticError && <p className="generation-error" role="alert">{semanticError}</p>}
                {semanticAnalysisReady && <div className="semantic-data-note"><i>i</i><p>{semanticResult.dataNote}</p></div>}
              </div>

              {semanticAnalysisReady ? <>
              <div className="semantic-insight-grid">
                <article className="semantic-intent-card">
                  <span>Поисковый интент</span>
                  <div><b>{semanticResult.intent.label}</b><small>{semanticResult.intent.stage}</small></div>
                  <p>{semanticResult.intent.summary}</p>
                </article>
                <article>
                  <span>Результат анализа · рекомендуемый материал</span>
                  <h4>{semanticResult.suggestedTopic}</h4>
                  <div className="semantic-plan-meta"><b>SEO‑статья</b><small>{semanticResult.recommendedLength.toLocaleString("ru-RU")} слов · подробный ответ</small></div>
                  <p className="semantic-result-source">Сформировано из запроса «{semanticResult.primaryQuery}». В генератор материал ещё не передан.</p>
                </article>
                <article className="semantic-selection-card">
                  <span>Собрано для брифа</span>
                  <div><b>{selectedSemanticKeywords.length}</b><small>из 8 фраз максимум</small></div>
                  <p>{selectedClusters} {selectedClusters === 1 ? "смысловая группа" : selectedClusters > 1 && selectedClusters < 5 ? "смысловые группы" : "смысловых групп"} · основной запрос {selectedSemanticKeywords.some((item) => item.role === "Основной") ? "выбран" : "не выбран"}</p>
                </article>
              </div>

              <div className="semantic-workbench">
                <aside className="semantic-clusters">
                  <div><span>Смысловые группы</span><small>Переключайте, чтобы не смешивать разные задачи читателя.</small></div>
                  <nav aria-label="Группы ключевых запросов">
                    {semanticClusters.map((cluster) => {
                      const count = cluster === "Все группы" ? semanticResult.keywords.length : semanticResult.keywords.filter((item) => item.cluster === cluster).length;
                      return <button type="button" className={activeSemanticCluster === cluster ? "active" : ""} onClick={() => setActiveSemanticCluster(cluster)} key={cluster}><span>{cluster}</span><b>{count}</b></button>;
                    })}
                  </nav>
                  <div className="semantic-cluster-tip"><i>✦</i><p><b>Рекомендация КЛИО</b>Для одной статьи обычно достаточно 5–8 фраз из нескольких близких групп.</p></div>
                </aside>

                <div className="semantic-keywords-panel">
                  <div className="semantic-keywords-head">
                    <div><span>{activeSemanticCluster}</span><h3>{visibleSemanticKeywords.length} поисковых формулировок</h3></div>
                    <div><button type="button" onClick={selectRecommendedSemantics}>Выбрать рекомендуемые</button><button type="button" onClick={clearSemanticSelection}>Очистить</button></div>
                  </div>

                  <div className={`semantic-selected-strip ${selectedSemanticKeywords.length ? "has-items" : ""}`}>
                    <span>Выбрано для генератора</span>
                    <div>{selectedSemanticKeywords.length ? selectedSemanticKeywords.map((item) => <button type="button" onClick={() => toggleSemanticKeyword(item.id)} key={item.id}>{item.phrase}<i>×</i></button>) : <small>Отметьте фразы в таблице — они появятся здесь.</small>}</div>
                  </div>

                  <div className="semantic-table" aria-label="Ключевые запросы">
                    <div className="semantic-table-head"><span>Выбор</span><span>Фраза</span><span>Интент</span><span>Связь</span><span>Охват</span></div>
                    {visibleSemanticKeywords.map((keyword) => {
                      const selected = selectedSemanticIds.includes(keyword.id);
                      const breadthClass = keyword.breadth === "Широкий" ? "high" : keyword.breadth === "Средний" ? "medium" : "niche";
                      return <div className={`semantic-keyword-row ${selected ? "is-selected" : ""}`} role="button" tabIndex={0} onClick={() => toggleSemanticKeyword(keyword.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleSemanticKeyword(keyword.id); } }} aria-pressed={selected} key={keyword.id}>
                        <span><i>{selected ? "✓" : ""}</i></span>
                        <span><b>{keyword.phrase}</b>{keyword.note && <small>{keyword.note}</small>}<em>{keyword.role}{keyword.recommended ? " · рекомендует КЛИО" : ""}</em></span>
                        <span>{keyword.intent}</span>
                        <span>{keyword.relation}</span>
                        <span><i className={`semantic-demand ${breadthClass}`}/>{keyword.breadth}<button type="button" className="semantic-keyword-copy" onClick={(event) => { event.stopPropagation(); copyPlainText(keyword.phrase, "Фраза"); }} aria-label={`Копировать фразу «${keyword.phrase}»`}><Icon name="copy"/></button></span>
                      </div>;
                    })}
                  </div>
                </div>
              </div>

              <div className="semantic-actionbar">
                <div className="semantic-actionbar-copy"><span>Основной следующий шаг</span><b>{selectedSemanticKeywords.length ? `${selectedSemanticKeywords.length} фраз готовы к использованию` : "Выберите ключевые фразы"}</b><small>Для обычной статьи этого достаточно: создайте текст сразу или откройте бриф для ручной настройки.</small></div>
                <label className="semantic-brand-route"><input type="checkbox" checked={useBrand} onChange={(event) => { setUseBrand(event.target.checked); setSemanticNeedsRefresh(true); setContentPlanNeedsRefresh(true); persistSemantics(semanticResult, selectedSemanticIds, semanticMode, semanticQuery, semanticRegion, semanticGeo, true); }}/><i/><span><b>Учесть профиль бренда</b><small>{useBrand ? "Модуль 01, включая открытые данные сайта, усилит факты и голос" : "Выключено — статья создаётся только по модулю 02"}</small></span></label>
                <div className="semantic-action-buttons">
                  <button className="button ghost" type="button" onClick={sendSemanticsToGenerator} disabled={!selectedSemanticKeywords.length || semanticNeedsRefresh}>Открыть подробный бриф</button>
                  <button className={`button primary large ${semanticArticleBusy ? "is-busy" : ""}`} type="button" onClick={generateFromSemantics} disabled={!activeBrandId || !selectedSemanticKeywords.length || semanticNeedsRefresh || semanticArticleBusy || aiConnection !== "connected" || workspaceAccount.generationsRemaining <= 0}><Icon name="spark"/>{semanticArticleBusy ? "Создаём статью…" : !activeBrandId ? "Загружаем кабинет" : aiConnection !== "connected" ? "ИИ не подключён" : workspaceAccount.generationsRemaining <= 0 ? "Лимит материалов исчерпан" : semanticNeedsRefresh ? "Сначала обновите семантику" : "Сгенерировать материал"}</button>
                </div>
                <div className="module-material-bar"><span><b>{moduleMaterialSources.semantics ? "Продолжаете сохранённую версию" : "Зафиксировать исследование"}</b><small>Сохранение и экспорт не расходуют лимиты.</small></span><div><button type="button" onClick={() => void saveModuleMaterial("semantics")} disabled={materialSavingType === "semantics"}>{materialSavingType === "semantics" ? "Сохраняем…" : moduleMaterialSources.semantics ? "Сохранить новую версию" : "Сохранить в материалы"}</button>{moduleMaterialSources.semantics && <button type="button" onClick={() => void saveModuleMaterial("semantics", "copy")} disabled={materialSavingType === "semantics"}>Сохранить копию</button>}</div></div>
                <div className="semantic-optional-route"><span><i>+</i><b>Нужен более глубокий SEO‑разбор?</b><small>Только тогда откройте анализ конкурентов. Он найдёт смысловые пробелы и передаст выбранные выводы в дополнительный акцент, не создавая новую семантику.</small></span><button type="button" onClick={openCompetitorAnalysis}>Сравнить страницы конкурентов</button></div>
              </div>
              </> : <div className="semantic-waiting-state">
                <div className="semantic-waiting-mark"><span>02</span><i>→</i></div>
                <div><span>{semanticMode === "idle" ? "Результата пока нет" : "Предыдущий результат скрыт"}</span><h3>{semanticMode === "idle" ? "Сначала соберите семантику по своей теме" : "Обновите анализ после изменения исходных данных"}</h3><p>{semanticMode === "idle" ? "После нажатия кнопки здесь появятся поисковый интент, рекомендуемый материал и смысловые группы. До этого КЛИО ничего не берёт из генератора." : "Старая рекомендация больше не показывается, потому что она относится к другому запросу, географии или профилю бренда."}</p></div>
                <ol><li><i>1</i><span>Введите тему</span></li><li><i>2</i><span>Проверьте географию</span></li><li><i>3</i><span>Запустите анализ</span></li></ol>
              </div>}
            </div>
          </section>

          <section className={`workspace-module competitor-module ${competitorOpen ? "" : "tool-collapsed"}`} id="competitors">
            <div className="workspace-module-heading tool-heading"><div><span>Самостоятельный инструмент · по желанию</span><h2>Анализ конкурентов</h2></div><p>Сравните конкретные страницы по теме или используйте модуль отдельно. Для обычной генерации этот этап не нужен.</p><button type="button" onClick={() => setCompetitorOpen((value) => !value)} aria-expanded={competitorOpen}>{competitorOpen ? "Свернуть" : "Открыть инструмент"}<i>{competitorOpen ? "−" : "+"}</i></button></div>

            <div className="competitor-optional-shell">
              <button type="button" className="competitor-entry-card" onClick={() => setCompetitorOpen((value) => !value)} aria-expanded={competitorOpen}>
                <span className="competitor-entry-copy"><span>Не входит в обязательный маршрут</span><strong>{competitorOpen ? "Анализ открыт" : "Нужна ли вам сравнительная матрица?"}</strong><small>{competitorOpen ? "Ниже можно задать тему и сравнить открытые страницы." : "Если задача — просто написать статью по теме, пропустите этот блок. Откройте его для конкурентного SEO‑исследования перед сложным или приоритетным материалом."}</small></span>
                <span className="competitor-entry-action"><b>{competitorOpen ? "Свернуть" : "Открыть анализ"}</b><i>{competitorOpen ? "−" : "+"}</i></span>
              </button>
              {competitorOpen && <div className="competitor-optional-body">

            <div className="competitor-setup-card">
              <div className="competitor-setup-head">
                <div><span>Контур анализа</span><h3>Задайте предмет сравнения</h3><p>КЛИО сопоставляет полноту ответа по выбранной теме: что уже раскрывает ваш бренд и как ту же задачу закрывают конкретные страницы конкурентов.</p></div>
                <span className={`competitor-mode competitor-mode-${competitorMode}`}><i/>{competitorMode === "ai" ? "AI‑анализ" : competitorMode === "demo" ? "Структурный анализ" : "Демонстрация"}</span>
              </div>

              <div className="competitor-comparison-guide">
                <div><i>01</i><span><b>Строки матрицы</b><small>темы, которые ожидает читатель по вашему запросу</small></span></div>
                <div><i>02</i><span><b>Ваш бренд</b><small>покрытие тем в профиле и на указанном сайте</small></span></div>
                <div><i>03</i><span><b>Конкуренты</b><small>покрытие тех же тем на выбранных страницах</small></span></div>
              </div>

              <div className="competitor-query-row">
                <label><span>Тема, основной запрос или категория бренда <em>{competitorFocusSource === "semantics" ? "из семантики" : competitorFocusSource === "brand" ? "из профиля бренда" : "ручной ввод"}</em></span><input value={competitorQuery} onChange={(event) => { const next = event.target.value; setCompetitorQuery(next); setCompetitorFocusSource("manual"); setCompetitorNeedsRefresh(true); persistCompetitorWorkspace({ query: next, focusSource: "manual", needsRefresh: true }); }} placeholder="Например: санаторий для восстановления" autoComplete="off"/></label>
                <div className="competitor-query-sources">
                  <button type="button" className={competitorFocusSource === "semantics" ? "is-active" : ""} onClick={useCurrentSemanticsForCompetitors}><i>02</i><span><b>Из семантики</b><small>{semanticAnalysisReady ? semanticResult.primaryQuery : "сначала выполните анализ"}</small></span></button>
                  <button type="button" className={competitorFocusSource === "brand" ? "is-active" : ""} onClick={useBrandForCompetitors}><i>01</i><span><b>Из бренда</b><small>{effectiveBrand.name}</small></span></button>
                </div>
              </div>

              <div className="competitor-source-list">
                <div className="competitor-source-head"><div><span>Страницы конкурентов</span><small>Добавьте ссылки вручную или используйте автоматический веб‑поиск, когда AI‑доступ подключён</small></div><button type="button" className={`competitor-discover ${competitorDiscoveryBusy ? "is-busy" : ""}`} onClick={discoverCompetitors} disabled={competitorDiscoveryBusy || aiConnection !== "connected"}><Icon name="spark"/>{competitorDiscoveryBusy ? "Ищем в интернете…" : aiConnection === "connected" ? "Подобрать автоматически" : aiConnection === "checking" ? "Проверяем подключение…" : "Автопоиск не подключён"}</button></div>
                {aiConnection === "disconnected" && <p className="competitor-search-status"><i>i</i><span><b>Почему ссылки не подставляются автоматически</b><small>В текущей версии не подключён реальный AI‑доступ к веб‑поиску. Поэтому КЛИО не имитирует поиск и не придумывает адреса: пока используйте ручные ссылки.</small></span></p>}
                {competitorDiscoveryNote && <p className="competitor-discovery-note"><Icon name="check"/>{competitorDiscoveryNote}</p>}
                {competitors.map((competitor, index) => <div className="competitor-source-row" key={competitor.id}>
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  <label><span>Название {competitor.origin === "ai" && <em>найдено ИИ</em>}</span><input value={competitor.label} onChange={(event) => updateCompetitorEntry(competitor.id, "label", event.target.value)} placeholder={`Конкурент ${index + 1}`} autoComplete="off"/></label>
                  <label className="competitor-url-field"><span>Ссылка на материал</span><input type="url" value={competitor.url} onChange={(event) => updateCompetitorEntry(competitor.id, "url", event.target.value)} placeholder="https://site.ru/page" autoComplete="off"/>{competitor.origin === "ai" && /^https?:\/\//i.test(competitor.url) && <a href={competitor.url} target="_blank" rel="noreferrer">Открыть найденный источник <Icon name="arrow"/></a>}</label>
                  <button type="button" className="competitor-remove" onClick={() => removeCompetitorEntry(competitor.id)} aria-label={`Удалить строку ${index + 1}`}>×</button>
                </div>)}
                <button type="button" className="competitor-add" onClick={addCompetitorEntry} disabled={competitors.length >= 5}>+ Добавить конкурента <span>{competitors.length}/5</span></button>
                <div className={`competitor-requirement ${validCompetitorEntries >= 2 ? "is-ready" : "is-needed"}`}><i>{validCompetitorEntries >= 2 ? <Icon name="check"/> : "2+"}</i><span><b>{validCompetitorEntries >= 2 ? "Источников достаточно для анализа" : "Добавьте минимум две страницы конкурентов"}</b><small>{validCompetitorEntries >= 2 ? `${validCompetitorEntries} ссылок будут проверены при построении матрицы.` : aiConnection === "connected" ? "Можно вставить ссылки вручную или подобрать их автоматически." : "Сейчас доступны ручные ссылки; автопоиск появится после подключения AI‑доступа."}</small></span></div>
              </div>

              <div className="competitor-setup-footer">
                <label><span>Редакционный акцент</span><AutoTextarea rows={2} value={competitorComment} onChange={(event) => { const next = event.target.value; setCompetitorComment(next); persistCompetitorWorkspace({ comment: next }); }} placeholder="Что особенно важно учесть в будущем материале?"/></label>
                <div className={`competitor-analysis-action ${competitorNeedsRefresh ? "needs-refresh" : ""}`}>
                  <span>{competitorNeedsRefresh ? "Данные изменены — обновите матрицу" : competitorMode === "example" ? "Можно запустить свой анализ" : "Матрица соответствует текущим настройкам"}</span>
                  <button className={`button primary large ${competitorBusy ? "is-busy" : ""}`} type="button" onClick={analyzeCompetitors} disabled={competitorBusy || workspaceAccount.researchRemaining <= 0}><Icon name="spark"/>{competitorBusy ? "Читаем страницы…" : workspaceAccount.researchRemaining <= 0 ? "Лимит исследований исчерпан" : competitorMode === "example" ? "Построить матрицу" : "Обновить матрицу"}</button>
                </div>
              </div>
              {competitorError && <p className="competitor-error" role="alert"><i>!</i><span>{competitorError}</span></p>}
              <p className="competitor-source-note"><i>i</i>КЛИО анализирует только открытый текст указанных страниц. Недоступные источники не считаются пустыми и отмечаются отдельным значком.</p>
            </div>

            <div className="competitor-summary-grid">
              <article><span>Источники</span><b>{loadedCompetitorSources}<small> / {competitorResult.competitors.length}</small></b><p>{competitorMode === "example" ? "демонстрационные страницы" : "страниц удалось прочитать"}</p></article>
              <article><span>Темы сравнения</span><b>{competitorResult.topics.length}</b><p>связаны с запросом и интентом</p></article>
              <article className="competitor-summary-accent"><span>Возможности</span><b>{competitorResult.gaps.length}</b><p>смысловых пробелов для усиления</p></article>
              <article><span>В будущий бриф</span><b>{selectedCompetitorTopics.length}<small> / 6</small></b><p>выбранных редакционных выводов</p></article>
            </div>

            <div className="competitor-matrix-card">
              <div className="competitor-matrix-head">
                <div><span>Сравнительная матрица</span><h3>Какие темы раскрывают страницы</h3><p>Ячейка показывает наличие смыслового блока, а не качество компании или услуги.</p></div>
                <div className="competitor-legend"><span><i className="coverage-strong"><CoverageIcon coverage="strong"/></i>Раскрыто</span><span><i className="coverage-partial"><CoverageIcon coverage="partial"/></i>Частично</span><span><i className="coverage-missing"><CoverageIcon coverage="missing"/></i>Не найдено</span><span><i className="coverage-unknown"><CoverageIcon coverage="unknown"/></i>Не проверено</span></div>
              </div>
              <div className="competitor-table-scroll">
                <table className="competitor-table">
                  <thead><tr><th>Тема и задача</th><th className="brand-column"><span>Ваш бренд</span><small>{useBrand ? effectiveBrand.name : "Профиль отключён"}</small></th>{competitorResult.competitors.map((source) => <th key={source.id}><span>{source.label}</span><small className={`source-${source.status}`}>{source.status === "loaded" ? "страница прочитана" : source.status === "example" ? "пример" : source.status === "blocked" ? "адрес отклонён" : "страница недоступна"}</small>{/^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{compactUrl(source.url)} <Icon name="arrow"/></a> : <em>{compactUrl(source.url)}</em>}</th>)}</tr></thead>
                  <tbody>{competitorResult.topics.map((item) => {
                    const selected = selectedCompetitorTopicIds.includes(item.id);
                    const brandMeta = competitorCoverageMeta[item.brandCoverage];
                    return <tr className={selected ? "is-selected" : ""} key={item.id}>
                      <th><button type="button" onClick={() => toggleCompetitorTopic(item.id)} aria-pressed={selected}><i>{selected ? "✓" : ""}</i><span><b>{item.title}</b><small>{item.cluster} · приоритет {item.priority.toLocaleLowerCase("ru-RU")}</small><em>{item.rationale}</em></span></button></th>
                      <td className="brand-column"><span className={`coverage coverage-${item.brandCoverage}`} title={brandMeta.label} aria-label={brandMeta.label}><i><CoverageIcon coverage={item.brandCoverage}/></i></span></td>
                      {competitorResult.competitors.map((source) => { const coverage = item.coverage[source.id] ?? "unknown"; const meta = competitorCoverageMeta[coverage]; return <td key={source.id}><span className={`coverage coverage-${coverage}`} title={meta.label} aria-label={meta.label}><i><CoverageIcon coverage={coverage}/></i></span></td>; })}
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <div className="competitor-matrix-footer"><p>{competitorResult.dataNote}</p><button type="button" onClick={selectRecommendedCompetitorTopics}>Выбрать рекомендации КЛИО</button></div>
            </div>

            <div className="competitor-insights-grid">
              <article>
                <span>Обязательный минимум</span><h3>Что раскрывают чаще всего</h3>
                <div>{competitorResult.commonTopics.length ? competitorResult.commonTopics.map((item) => <p key={item}><i>✓</i>{item}</p>) : <p><i>·</i>Недостаточно доступных страниц для общего вывода</p>}</div>
                <small>Эти темы нужны для полноты ответа, но сами по себе не дают отличия.</small>
              </article>
              <article className="competitor-opportunity-card">
                <span>Точки роста</span><h3>Где можно быть полезнее</h3>
                <div>{competitorResult.gaps.map((item) => <p key={item}><i>↗</i>{item}</p>)}</div>
                <small>Пробел — это редакционная возможность, а не автоматическая рекомендация добавить неподтверждённый факт.</small>
              </article>
              <article>
                <span>Черновая структура</span><h3>{competitorResult.suggestedTitle}</h3>
                <ol>{competitorResult.suggestedStructure.map((item, index) => <li key={item}><i>{String(index + 1).padStart(2, "0")}</i>{item}</li>)}</ol>
              </article>
            </div>

            <div className={`competitor-actionbar ${competitorNeedsRefresh ? "needs-refresh" : ""}`}>
              <div><span>Необязательное усиление</span><b>{selectedCompetitorTopics.length ? `${selectedCompetitorTopics.length} выводов готовы для материала` : "Выберите темы в матрице"}</b><small>В генераторе тема будет заполнена текущим запросом, а выводы попадут в поле «Дополнительный акцент». Уже выбранные ключевые слова не изменятся.</small></div>
              <div className="competitor-selected-topics">{selectedCompetitorTopics.slice(0, 3).map((item) => <span key={item.id}>{item.title}</span>)}{selectedCompetitorTopics.length > 3 && <span>+{selectedCompetitorTopics.length - 3}</span>}</div>
              <div className="competitor-action-buttons"><button type="button" className="module-save-button" onClick={() => void saveModuleMaterial("competitors")} disabled={materialSavingType === "competitors" || competitorNeedsRefresh}>{materialSavingType === "competitors" ? "Сохраняем…" : moduleMaterialSources.competitors ? "Сохранить новую версию" : "Сохранить в материалы"}</button>{moduleMaterialSources.competitors && <button type="button" className="module-copy-button" onClick={() => void saveModuleMaterial("competitors", "copy")} disabled={materialSavingType === "competitors"}>Копия</button>}<button className={`button primary large ${!selectedCompetitorTopics.length || competitorNeedsRefresh ? "is-blocked" : ""}`} type="button" onClick={sendCompetitorInsightsToGenerator} aria-disabled={!selectedCompetitorTopics.length || competitorNeedsRefresh}>Передать тему и выводы <Icon name="arrow"/></button></div>
            </div>
              </div>}
            </div>
          </section>

          <section className="workspace-module generator-module" id="generator">
            <div className="workspace-module-heading"><div><span>Главный экран</span><h2>Генератор материалов</h2></div><p>Укажите формат, тему, ключевые слова и то, что важно раскрыть. Остальные инструменты подключаются только по необходимости.</p></div>
            <div className="studio">
              <aside className="brief-panel">
                <div className="brief-step"><div className="brief-step-label"><span>Шаг 01</span><b>Бриф материала</b></div><button type="button" className="brief-reset" onClick={resetGeneratorBrief}>Начать заново</button></div>
                <div className="generator-mode-switch" role="radiogroup" aria-label="Режим генератора">
                  <button type="button" className={generatorMode === "quick" ? "active" : ""} onClick={() => setGeneratorMode("quick")} role="radio" aria-checked={generatorMode === "quick"}><i>✦</i><span><b>Новичок</b><small>опишите задачу в одном окне</small></span></button>
                  <button type="button" className={generatorMode === "advanced" ? "active" : ""} onClick={() => setGeneratorMode("advanced")} role="radio" aria-checked={generatorMode === "advanced"}><i>≡</i><span><b>Эксперт</b><small>формат, ключи, стиль отдельно</small></span></button>
                </div>
                {generatorMode === "quick" && <div className="generator-quick">
                  <label className="field">Опишите задачу<AutoTextarea rows={6} value={quickPrompt} onChange={(event) => setQuickPrompt(event.target.value)} placeholder="Например: напиши SEO-статью про ORCA (сайт theorca.pro) — платформа для трейдеров с no-code сканерами и стратегиями. Аудитория — активные трейдеры."/><small>Опишите бренд, сайт или тему и что нужно написать — формат, тон и объём КЛИО определит сама. Если назван реальный бренд или сайт, КЛИО проверит факты в вебе, а не будет их выдумывать.</small></label>
                  {quickError && <p className="generation-error" role="alert">{quickError}</p>}
                  <button className={`button primary generate ${quickBusy ? "is-busy" : ""}`} type="button" onClick={() => void generateQuick()} disabled={!activeBrandId || quickBusy || aiConnection !== "connected" || workspaceAccount.generationsRemaining <= 0}><Icon name="spark"/>{quickBusy ? "КЛИО пишет…" : !activeBrandId ? "Загружаем кабинет" : aiConnection !== "connected" ? "Сначала подключите ИИ" : workspaceAccount.generationsRemaining <= 0 ? "Лимит материалов исчерпан" : "Сгенерировать материал"}</button>
                </div>}
                {generatorMode === "advanced" && <>
                <div className="field"><label>Формат</label><div className="format-tabs">{formats.map((item) => <button type="button" className={format === item.id ? "active" : ""} onClick={() => changeFormat(item.id)} key={item.id}>{item.label}</button>)}</div></div>
                <div className={`editorial-plan-card generator-plan-card ${generatorAdvanced ? "" : "generator-advanced-hidden"}`}>
                  <div><span>Редакционный контракт</span><b>{activeFormatPlan.title}</b><small>{activeFormatPlan.summary}</small></div>
                  <ol>{activeFormatPlan.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                  <p><i>Итог</i>{activeFormatPlan.result}</p>
                </div>
                <label className="field">Тема материала<input value={topic} onChange={(event) => { setTopic(event.target.value); setGenerationCoverage(null); }} autoComplete="off" /></label>
                <label className="field">Ключевые слова<AutoTextarea value={keywords} onChange={(event) => { setKeywords(event.target.value); setGenerationCoverage(null); }} /><small>Разделяйте запросы запятыми или получите их после анализа выдачи</small></label>
                <label className="field generator-accent-field">Дополнительный акцент<AutoTextarea rows={3} value={accent} onChange={(event) => { setAccent(event.target.value); setGenerationCoverage(null); }} placeholder="Например: раскрыть питание, ограничения и порядок консультации"/><small>{(accent.match(/^\s*[•*\-–—]\s+/gm) ?? []).length ? `Распознано обязательных редакционных ориентиров: ${(accent.match(/^\s*[•*\-–—]\s+/gm) ?? []).length}` : "Можно ввести вручную или передать выводы из матрицы. Ориентиры влияют на разделы статьи, а не остаются служебной заметкой."}</small></label>
                <div className="generator-context-card">
                  <div className="generator-context-head"><span>Контекст КЛИО</span><small>Выберите источники для материала. Если модуль ещё не подготовлен, КЛИО сохранит выбор и покажет, что нужно сделать перед его подключением.</small></div>
                  <div className="generator-context-options">
                    <label className={`${generatorBrandReady ? "is-ready" : "is-pending"} ${generatorUseBrand ? "is-checked" : ""}`}>
                      <input type="checkbox" checked={generatorUseBrand} onChange={(event) => {
                        const checked = event.target.checked;
                        setGeneratorUseBrand(checked);
                        if (checked && !generatorBrandReady) showToast("Выбор сохранён — сначала заполните и включите профиль бренда");
                      }}/>
                      <i aria-hidden="true">✓</i>
                      <span><b>Профиль бренда</b><small>{generatorBrandReady ? `${effectiveBrand.name} · готовность ${brandScore}%` : generatorUseBrand ? useBrand ? "Выбран · заполните профиль бренда" : "Выбран · включите профиль в модуле 01" : "Не использовать в этой генерации"}</small></span>
                    </label>
                    <label className={`${generatorSemanticsReady ? "is-ready" : "is-pending"} ${generatorUseSemantics ? "is-checked" : ""}`}>
                      <input type="checkbox" checked={generatorUseSemantics} onChange={(event) => {
                        const checked = event.target.checked;
                        setGeneratorUseSemantics(checked);
                        if (checked && !generatorSemanticsReady) showToast("Выбор сохранён — сначала подготовьте семантику в разделе «Семантика»");
                      }}/>
                      <i aria-hidden="true">✓</i>
                      <span><b>Семантика</b><small>{generatorSemanticsReady ? `${selectedSemanticKeywords.length} фраз · ${semanticResult.intent.label || "интент определён"}` : generatorUseSemantics ? semanticNeedsRefresh ? "Выбрана · соберите или обновите семантику" : "Выбрана · отметьте ключевые фразы" : "Не использовать в этой генерации"}</small></span>
                    </label>
                    <label className={`${generatorCompetitorsReady ? "is-ready" : "is-pending"} ${generatorUseCompetitors ? "is-checked" : ""}`}>
                      <input type="checkbox" checked={generatorUseCompetitors} onChange={(event) => {
                        const checked = event.target.checked;
                        setGeneratorUseCompetitors(checked);
                        if (checked && !generatorCompetitorsReady) showToast("Выбор сохранён — сначала постройте конкурентную матрицу");
                      }}/>
                      <i aria-hidden="true">✓</i>
                      <span><b>Анализ конкурентов</b><small>{generatorCompetitorsReady ? `${selectedCompetitorTopics.length} выводов из актуальной матрицы` : generatorUseCompetitors ? "Выбран · постройте матрицу и отметьте выводы" : "Не использовать в этой генерации"}</small></span>
                    </label>
                  </div>
                </div>
                <button className="generator-advanced-toggle" type="button" onClick={() => setGeneratorAdvanced((value) => !value)} aria-expanded={generatorAdvanced}><span><b>{generatorAdvanced ? "Скрыть профессиональные настройки" : "Профессиональные настройки"}</b><small>Стиль, объём и редакционный план формата</small></span><i>{generatorAdvanced ? "−" : "+"}</i></button>
                <div className={`field two ${generatorAdvanced ? "" : "generator-advanced-hidden"}`}>
                  <ModuleSelect label="Стиль" value={tone} options={styles.map((item) => ({ value: item, label: item }))} onChange={setTone}/>
                  <ModuleSelect label="Объём" value={customLength ? "custom" : String(length)} options={[...lengthPresets[format].map((item) => ({ value: String(item.value), label: item.label })), { value: "custom", label: "Свой объём…" }]} onChange={changeLength}/>
                </div>
                <p className={`tone-contract-note ${generatorAdvanced ? "" : "generator-advanced-hidden"}`}><i>Стиль: {tone}</i> меняет лексику и ритм, но не превращает выбранный формат в другой тип материала.</p>
                {customLength && <label className={`field custom-length ${generatorAdvanced ? "" : "generator-advanced-hidden"}`}>Свой объём<div><input type="number" min="30" max="4000" step="10" value={length} onChange={(event) => setManualLength(event.target.value)} inputMode="numeric"/><span>слов</span></div><small>Можно указать от 30 до 4 000 слов</small></label>}
                {generationError && <p className="generation-error" role="alert">{generationError}</p>}
                <button className={`button primary generate ${busy ? "is-busy" : ""}`} type="button" onClick={generate} disabled={!activeBrandId || busy || aiConnection !== "connected" || workspaceAccount.generationsRemaining <= 0}><Icon name="spark"/>{busy ? busySteps[busyStep] : !activeBrandId ? "Загружаем кабинет" : aiConnection !== "connected" ? "Сначала подключите ИИ" : workspaceAccount.generationsRemaining <= 0 ? "Лимит материалов исчерпан" : "Сгенерировать материал"}</button>
                {busy && <div className="generation-progress" aria-hidden="true"><i style={{ width: `${((busyStep + 1) / busySteps.length) * 100}%` }}/></div>}
                </>}
              </aside>
              <article className="result-panel">
                <div className="result-head"><div><span className={`status status-${generationMode}`}><i/>{generationMode === "ai" ? "Создано КЛИО" : generationMode === "demo" ? "Сохранённая версия" : aiConnection === "connected" ? "Ожидает генерацию" : "ИИ не подключён"}</span><small>{words.toLocaleString("ru-RU")} / {length.toLocaleString("ru-RU")} слов · {tone}</small></div><div className="result-head-actions"><button type="button" className="result-clear" onClick={clearGeneratedResult} disabled={!title && !body}><Icon name="erase"/> Очистить</button><button type="button" onClick={copyResult}><Icon name="copy"/> Копировать текст</button></div></div>
                <div className={`length-control ${targetChecked ? (withinTarget ? "is-ok" : "is-warning") : "is-idle"}`}><span><i/>{targetChecked ? (withinTarget ? "Объём в цели" : "Объём отличается от заданного") : "Контроль включится после генерации"}</span><b>{targetChecked ? `${Math.round((words / Math.max(length, 1)) * 100)}%` : "—"}</b><u><i style={{ width: `${targetChecked ? Math.min(100, (words / Math.max(length, 1)) * 100) : 0}%` }}/></u><small>{targetChecked && !withinTarget ? "Это ориентир, а не жёсткое правило — при желании сократите или дополните текст ниже." : `Ориентир: от ${Math.floor(length * 0.85).toLocaleString("ru-RU")} до ${Math.ceil(length * 1.15).toLocaleString("ru-RU")} слов`}</small></div>
                <AutoTextarea className="result-title" rows={1} value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Заголовок результата"/>
                <AutoTextarea className="result-body" value={body} onChange={(event) => setBody(event.target.value)} aria-label="Текст результата"/>
                {generationCoverage && <div className="generation-brief-check"><div><span>Контроль брифа</span><small>Проверено до выдачи материала</small></div><p className={generationCoverage.subjectApplied ? "is-ready" : "is-missing"}><i>{generationCoverage.subjectApplied ? "✓" : "!"}</i><span><b>Предмет темы</b><small>{generationCoverage.subjectApplied ? `раскрыт в ${generationCoverage.subjectSections} смысловых блоках` : "недостаточно раскрыт"}</small></span></p><p className={!generationCoverage.keywordMissing.length ? "is-ready" : "is-missing"}><i>{!generationCoverage.keywordMissing.length ? "✓" : "!"}</i><span><b>Ключевые фразы</b><small>{generationCoverage.keywordTotal ? `${generationCoverage.keywordApplied.length} из ${generationCoverage.keywordTotal} использованы в тексте` : "ключевые фразы не задавались"}</small></span></p><p className={!generationCoverage.editorialFocusMissing.length ? "is-ready" : "is-missing"}><i>{!generationCoverage.editorialFocusMissing.length ? "✓" : "!"}</i><span><b>Редакционные ориентиры</b><small>{generationCoverage.editorialFocusTotal ? `${generationCoverage.editorialFocusApplied.length} из ${generationCoverage.editorialFocusTotal} применены` : "дополнительные ориентиры не передавались"}</small></span></p><p className="is-ready"><i>✓</i><span><b>География спроса</b><small>{generationCoverage.geographyApplied.length ? generationCoverage.geographyApplied.join(", ") : "отдельная география не задана"}</small></span></p></div>}
                <aside className="editor-note"><span>Комментарий к материалу</span><p>{editorNote}</p><small>Не входит в текст и не копируется</small></aside>
                <div className="seo-passport">
                  <div className="seo-passport-head"><span>SEO‑паспорт</span><small>Служебные поля для публикации</small></div>
                  <label><span className="seo-field-label"><b>SEO‑заголовок</b><button type="button" onClick={() => copyPlainText(metaTitle, "SEO‑заголовок")}><Icon name="copy"/> Копировать</button></span><AutoTextarea rows={1} value={metaTitle} onChange={(event) => setMetaTitle(event.target.value)} aria-label="SEO‑заголовок"/><small>{metaTitle.length} знаков</small></label>
                  <label><span className="seo-field-label"><b>Метаописание</b><button type="button" onClick={() => copyPlainText(metaDescription, "Метаописание")}><Icon name="copy"/> Копировать</button></span><AutoTextarea rows={2} value={metaDescription} onChange={(event) => setMetaDescription(event.target.value)} aria-label="Метаописание"/><small>{metaDescription.length} знаков</small></label>
                </div>
                <div ref={metricsRef} className={`quality-zone ${metricsVisible ? "is-visible" : ""}`} aria-live="polite" aria-atomic="true">
                  <div className="quality-head"><span>Идеи для полировки</span><small><i/> Необязательно — материал уже готов к публикации</small></div>
                  <div className="quality-grid">
                    <div className="quality-card" key={`seo-${metricsReplay}`}><small>SEO</small><b><MetricNumber value={quality.seo} replay={metricsReplay}/><em>/100</em></b><span>{quality.seo >= 80 ? "сильное соответствие" : "можно улучшить"}</span><i><u style={{ "--score": `${quality.seo}%` } as CSSProperties}/></i>{quality.seoTips.length > 0 && quality.seo < 80 && <ul className="quality-tips">{quality.seoTips.map((tip) => <li key={tip}>{tip}</li>)}</ul>}</div>
                    <div className="quality-card" key={`read-${metricsReplay}`}><small>Читаемость</small><b><MetricNumber value={quality.readability} replay={metricsReplay}/><em>/100</em></b><span>{quality.readability >= 80 ? "комфортный ритм" : "можно улучшить"}</span><i><u style={{ "--score": `${quality.readability}%` } as CSSProperties}/></i>{quality.readabilityTips.length > 0 && quality.readability < 80 && <ul className="quality-tips">{quality.readabilityTips.map((tip) => <li key={tip}>{tip}</li>)}</ul>}</div>
                    <div className="quality-card" key={`keys-${metricsReplay}`}><small>Ключи</small><b><MetricNumber value={quality.keysFound} replay={metricsReplay}/><em>/{keyList.length}</em></b><span>с учётом словоформ</span><i><u style={{ "--score": `${keyList.length ? (quality.keysFound / keyList.length) * 100 : 0}%` } as CSSProperties}/></i></div>
                  </div>
                </div>
                <div className="result-footer"><span>Материал и SEO‑поля можно редактировать прямо в кабинете</span><button type="button" onClick={copyResult}>Скопировать материал ↗</button></div>
              </article>
            </div>
          </section>

          <section className={`workspace-module content-plan-module ${contentPlanOpen ? "" : "tool-collapsed"}`} id="content-plan">
            <div className="workspace-module-heading tool-heading"><div><span>Самостоятельный инструмент · по желанию</span><h2>Контент‑план</h2></div><p>Создайте очередь публикаций и экспортируйте её отдельно либо отправляйте выбранные строки в генератор.</p><button type="button" onClick={() => setContentPlanOpen((value) => !value)} aria-expanded={contentPlanOpen}>{contentPlanOpen ? "Свернуть" : "Открыть инструмент"}<i>{contentPlanOpen ? "−" : "+"}</i></button></div>
            <div className="content-plan-shell">
              <article className="content-plan-setup">
                <div className="content-plan-setup-head">
                  <div><span>Основа плана</span><h3>От запроса к серии публикаций</h3><p>Можно начать вручную или взять текущую тему из раздела «Семантика». Для одной статьи этот этап не нужен.</p></div>
                  <span className={`status status-${contentPlanMode === "ai" ? "ai" : "example"}`}><i/>{contentPlanMode === "ai" ? "AI‑план" : aiConnection === "connected" ? "Ожидает тему" : "ИИ не подключён"}</span>
                </div>

                <div className="content-plan-query-row">
                  <label><span>Основная тема или направление</span><input value={contentPlanQuery} onChange={(event) => { const next = event.target.value; setContentPlanQuery(next); setContentPlanNeedsRefresh(true); setContentPlanError(""); persistContentPlan({ query: next, needsRefresh: true }); }} placeholder="Например: санаторий для лечения желудка" autoComplete="off"/></label>
                  <button type="button" onClick={useCurrentSemanticsForPlan} disabled={!semanticAnalysisReady}><Icon name="arrow"/> Взять из семантики</button>
                </div>

                <div className="content-plan-goal">
                  <span>Для чего план</span>
                  <div>{CONTENT_PLAN_GOALS.map((goal) => <button type="button" className={contentPlanGoal === goal.id ? "active" : ""} onClick={() => { setContentPlanGoal(goal.id); setContentPlanNeedsRefresh(true); persistContentPlan({ goal: goal.id, needsRefresh: true }); }} key={goal.id}>{goal.label}</button>)}</div>
                  <small>{CONTENT_PLAN_GOALS.find((goal) => goal.id === contentPlanGoal)?.hint}</small>
                </div>

                <div className="content-plan-source-strip" aria-label="Источники будущего плана">
                  <button type="button" className={semanticAnalysisReady ? "is-ready" : ""} onClick={() => goToModule("semantics", () => setSemanticOpen(true))}><i>{semanticAnalysisReady ? "✓" : "02"}</i><span><b>Семантика</b><small>{semanticAnalysisReady ? `${selectedSemanticKeywords.length} выбранных фраз` : "можно собрать или пропустить"}</small></span></button>
                  <button type="button" className={selectedGeoScopes.length ? "is-ready" : ""} onClick={() => goToModule("semantics", () => setSemanticOpen(true))}><i>{selectedGeoScopes.length ? "✓" : "—"}</i><span><b>География</b><small>{selectedGeoScopes.length ? semanticGeoSummary : "вся Россия"}</small></span></button>
                  <button type="button" className={!competitorNeedsRefresh && selectedCompetitorTopics.length ? "is-ready" : ""} onClick={() => goToModule("competitors", () => setCompetitorOpen(true))}><i>{!competitorNeedsRefresh && selectedCompetitorTopics.length ? "✓" : "+"}</i><span><b>Матрица</b><small>{!competitorNeedsRefresh && selectedCompetitorTopics.length ? `${selectedCompetitorTopics.length} ориентиров` : "необязательно"}</small></span></button>
                  <button type="button" className={useBrand ? "is-ready" : ""} onClick={() => goToModule("brand-profile", () => setBrandOpen(true))}><i>{useBrand ? "✓" : "—"}</i><span><b>Бренд</b><small>{useBrand ? effectiveBrand.name : "профиль отключён"}</small></span></button>
                </div>
                <p className="content-plan-source-hint">Не просто статус — можно кликнуть, чтобы перейти в нужный модуль и заполнить его. Включаются в модулях 01–03 выше.</p>

                <div className="content-plan-controls">
                  <div><span>Количество тем</span><div>{[10, 15, 25].map((value) => <button type="button" className={contentPlanCount === value ? "active" : ""} onClick={() => { setContentPlanCount(value); setContentPlanNeedsRefresh(true); persistContentPlan({ count: value, needsRefresh: true }); }} key={value}>{value}</button>)}</div></div>
                  <button className={`button primary large ${contentPlanBusy ? "is-busy" : ""}`} type="button" onClick={buildContentPlan} disabled={contentPlanBusy || aiConnection !== "connected" || workspaceAccount.researchRemaining <= 0}><Icon name="spark"/>{contentPlanBusy ? "Собираем систему…" : aiConnection !== "connected" ? "Сначала подключите ИИ" : workspaceAccount.researchRemaining <= 0 ? "Лимит исследований исчерпан" : contentPlanResult.items.length ? "Обновить контент‑план" : "Собрать контент‑план"}</button>
                </div>
                {contentPlanError && <p className="generation-error" role="alert">{contentPlanError}</p>}
              </article>

              {contentPlanResult.items.length ? <>
                <div className={`content-plan-summary ${contentPlanNeedsRefresh ? "needs-refresh" : ""}`}>
                  <article><span>Темы</span><b>{contentPlanResult.items.length}</b><small>без дублей заголовков</small></article>
                  <article><span>Кластеры</span><b>{contentPlanResult.clusters.length}</b><small>разные задачи читателя</small></article>
                  <article><span>В работе</span><b>{contentPlanProgress.working}</b><small>переданы в генератор</small></article>
                  <article><span>Готово</span><b>{contentPlanProgress.ready}</b><small>отмечено редактором</small></article>
                </div>

                <div className="content-plan-list">
                  {contentPlanResult.items.map((item) => {
                    const originalIndex = contentPlanResult.items.findIndex((candidate) => candidate.id === item.id);
                    const expanded = expandedPlanItem === item.id;
                    const statusClass = item.status === "Готово" ? "done" : item.status === "В работе" ? "work" : "plan";
                    return <article className={`content-plan-item status-${statusClass} ${expanded ? "is-expanded" : ""}`} key={item.id}>
                      <div className="content-plan-item-main">
                        <label className={`content-plan-select ${selectedPlanItemIds.includes(item.id) ? "is-selected" : ""}`}><input type="checkbox" checked={selectedPlanItemIds.includes(item.id)} onChange={() => togglePlanItemSelection(item.id)}/><i>{selectedPlanItemIds.includes(item.id) ? "✓" : ""}</i><span>Выбрать</span></label>
                        <span className="content-plan-index">{String(originalIndex + 1).padStart(2, "0")}</span>
                        <div className="content-plan-item-copy">
                          <div><span>{item.cluster}</span><i>{item.format}</i><i>{item.intent}</i><i>{item.stage}</i><em className={`priority-${item.priority === "Высокий" ? "high" : item.priority === "Средний" ? "medium" : "extra"}`}>{item.priority}</em></div>
                          <h3>{item.title}</h3>
                          <p><span>Основной запрос</span><b>{item.primaryKeyword}</b></p>
                        </div>
                        <div className={`content-plan-status status-${statusClass}`}><ModuleSelect label="Статус" value={item.status} options={CONTENT_PLAN_STATUS_OPTIONS} onChange={(value) => updateContentPlanStatus(item.id, value as ContentPlanStatus)}/></div>
                        <div className="content-plan-item-actions"><button type="button" onClick={() => setExpandedPlanItem(expanded ? null : item.id)}>{expanded ? "Скрыть бриф" : "Открыть бриф"}</button><button type="button" onClick={() => sendPlanItemToGenerator(item)}>В генератор <Icon name="arrow"/></button></div>
                      </div>
                      {expanded && <div className="content-plan-brief">
                        <div className="content-plan-strategy"><section><span>Редакционный ракурс</span><p>{item.angle}</p></section><section><span>Коммуникационная цель</span><p>{item.objective}</p></section><section><span>Следующий шаг</span><p>{item.cta || "Определяется редактором"}</p></section></div>
                        <div className="content-plan-seo"><label><span className="seo-field-label"><b>SEO‑заголовок</b><button type="button" onClick={() => copyPlainText(item.metaTitle, "SEO‑заголовок")}><Icon name="copy"/> Копировать</button></span><p>{item.metaTitle}</p><small>{item.metaTitle.length} знаков</small></label><label><span className="seo-field-label"><b>Метаописание</b><button type="button" onClick={() => copyPlainText(item.metaDescription, "Метаописание")}><Icon name="copy"/> Копировать</button></span><p>{item.metaDescription}</p><small>{item.metaDescription.length} знаков</small></label></div>
                        <div className="content-plan-brief-grid"><section><span>Поддерживающая семантика и сущности</span><div>{item.lsi.map((phrase) => <i key={phrase}>{phrase}</i>)}</div></section><section><span>Целевая аудитория</span><p>{item.audience}</p></section><section><span>Структура материала</span><ol>{item.structure.map((part, index) => <li key={part}><i>{index + 1}</i>{part}</li>)}</ol></section><section><span>Фактура для проверки</span><div>{item.evidenceNeeded.length ? item.evidenceNeeded.map((source) => <i key={source}>{source}</i>) : <p>Дополнительная фактура не запрошена.</p>}</div></section><section><span>На чём основана тема</span><div>{item.sources.map((source) => <i key={source}>{source}</i>)}</div></section></div>
                      </div>}
                    </article>;
                  })}
                </div>

                {contentPlanResult.dataNote && <div className="content-plan-note"><i>i</i><p>{contentPlanResult.dataNote}</p></div>}

                <div className="content-plan-actions">
                  <div className="content-plan-toolbar-actions">
                    <button type="button" className="button ghost" onClick={() => void saveModuleMaterial("content_plan")} disabled={materialSavingType === "content_plan"}>{materialSavingType === "content_plan" ? "Сохраняем…" : moduleMaterialSources.content_plan ? "Сохранить новую версию" : "Сохранить в материалы"}</button>
                    {moduleMaterialSources.content_plan && <button type="button" className="button ghost" onClick={() => void saveModuleMaterial("content_plan", "copy")} disabled={materialSavingType === "content_plan"}>Копия</button>}
                    <button type="button" className="button ghost" onClick={exportContentPlan}><Icon name="arrow"/> Скачать план (CSV)</button>
                  </div>
                  <div className="content-plan-selection-bar">
                    <span>{selectedPlanItemIds.length > 0 ? <><b>Выбрано: {selectedPlanItemIds.length}</b><small>Остальные темы и их статусы не изменятся</small></> : <small>Отметьте темы «Выбрать», чтобы заменить их на другие</small>}</span>
                    <div>
                      <button type="button" className="button ghost" onClick={() => { setSelectedPlanItemIds([]); setPlanReplacements([]); setPlanReplacementOpen(false); }} disabled={!selectedPlanItemIds.length}>Снять выбор</button>
                      <button type="button" className="button primary" onClick={() => setPlanReplacementOpen(true)} disabled={!selectedPlanItemIds.length}>Заменить выбранные</button>
                    </div>
                  </div>
                </div>

                {planReplacementOpen && <section className="content-plan-replacement" aria-label="Замена выбранных тем">
                  <div className="content-plan-replacement-head"><div><span>Точечная замена</span><h3>Новые варианты только для выбранных тем</h3><p>Один запрос заменяет до пяти тем и расходует одно редакторское действие.</p></div><button type="button" onClick={() => { setPlanReplacementOpen(false); setPlanReplacements([]); setPlanReplacementError(""); }} aria-label="Закрыть замену">×</button></div>
                  <div className="content-plan-replacement-options"><span>Что изменить</span><div>{["Другой ракурс", "Исключить похожие темы", "Более продающая тема", "Другой формат"].map((option) => <button type="button" className={planReplacementPreference === option ? "active" : ""} onClick={() => setPlanReplacementPreference(option)} key={option}>{option}</button>)}</div></div>
                  <label className="content-plan-replacement-comment"><span>Дополнительное пожелание · необязательно</span><AutoTextarea rows={2} value={planReplacementComment} onChange={(event) => setPlanReplacementComment(event.target.value)} placeholder="Например: больше практических тем для аудитории 45+"/></label>
                  {planReplacementError && <p className="generation-error" role="alert">{planReplacementError}</p>}
                  <button className="button primary" type="button" onClick={() => void requestPlanReplacements()} disabled={planReplacementBusy || workspaceAccount.editorActionsRemaining <= 0}>{planReplacementBusy ? "Подбираем варианты…" : workspaceAccount.editorActionsRemaining <= 0 ? "Лимит AI‑редактуры исчерпан" : `Предложить замену для ${selectedPlanItemIds.length} ${selectedPlanItemIds.length === 1 ? "темы" : "тем"}`}</button>
                  {planReplacements.length > 0 && <div className="content-plan-replacement-groups">{planReplacements.map((group) => {
                    const source = contentPlanResult.items.find((item) => item.id === group.sourceId);
                    return <article key={group.sourceId}><div><span>Исходная тема</span><h4>{source?.title}</h4><button type="button" onClick={() => keepOriginalPlanItem(group.sourceId)}>Оставить исходную</button></div><div>{group.alternatives.map((alternative) => <button type="button" onClick={() => applyPlanReplacement(group.sourceId, alternative)} key={alternative.id}><span>{alternative.format} · {alternative.intent}</span><b>{alternative.title}</b><small>{alternative.angle}</small><em>Выбрать вариант <Icon name="arrow"/></em></button>)}</div></article>;
                  })}</div>}
                </section>}
              </> : <div className="content-plan-empty"><i>25</i><div><span>Контент‑стратегия</span><h3>Одна тема превращается в управляемую очередь</h3><p>AI‑стратег разведёт интенты, этапы воронки и форматы, подготовит SEO‑заголовок, метаописание, основной запрос, поддерживающую семантику, цель, фактуру и структуру. Любую строку можно передать в генератор одним действием.</p></div></div>}
            </div>
          </section>

          <section className={`workspace-module adaptation-module ${adaptationOpen ? "" : "tool-collapsed"}`} id="adaptation">
            <div className="workspace-module-heading tool-heading"><div><span>Самостоятельный инструмент · по желанию</span><h2>Редакторы КЛИО</h2></div><p>Двенадцать собственных режимов: вычитка, ясность, пересборка, сильное начало, SEO, соцсети, реклама и первое деловое письмо.</p><button type="button" onClick={() => setAdaptationOpen((value) => !value)} aria-expanded={adaptationOpen}>{adaptationOpen ? "Свернуть" : "Открыть инструмент"}<i>{adaptationOpen ? "−" : "+"}</i></button></div>
            <div className="adaptation-shell">
              <article className="adaptation-input-card">
                <div className="adaptation-card-head"><div><span>Исходник заказчика</span><h3>Вставьте готовый текст</h3></div><b>{adaptationSourceWords.toLocaleString("ru-RU")} слов</b></div>
                <label className="adaptation-source-field"><AutoTextarea className="adaptation-source-textarea" rows={10} value={adaptationSource} onChange={(event) => setAdaptationSource(event.target.value)} placeholder="Вставьте статью, пост, описание услуги или другой готовый материал…"/><small>Поле увеличивается вместе с текстом, а для длинного материала включает внутреннюю прокрутку. Исходник не перезаписывается.</small></label>

                <label className="adaptation-field"><span>Ключевые фразы <small>необязательно</small></span><AutoTextarea rows={2} value={adaptationKeywords} onChange={(event) => setAdaptationKeywords(event.target.value)} placeholder="Например: санаторий в Карелии, восстановление"/></label>
                <label className="adaptation-field"><span>Комментарий редактору <small>необязательно</small></span><AutoTextarea rows={2} value={adaptationInstructions} onChange={(event) => setAdaptationInstructions(event.target.value)} placeholder="Что важно сохранить, убрать или подчеркнуть"/></label>

                <div className="adaptation-task"><span>Выберите режим КЛИО</span><div className="adaptation-goals">{adaptationGoals.map((item) => {
                  const active = adaptationGoal === item.id;
                  return <article className={active ? "active" : ""} key={item.id}>
                    <button type="button" className={active ? "active" : ""} onClick={() => { setAdaptationGoal(item.id); setAdaptationResult(null); setAdaptationMode("example"); }} aria-expanded={active}><i>{active ? "✓" : ""}</i><span><b>{item.label}</b><small>{item.detail}</small></span></button>
                    {active && <div className="adaptation-goal-scenario"><span>Сценарий режима</span><b>{ADAPTATION_PLANS[item.id].result}</b><ol>{ADAPTATION_PLANS[item.id].steps.map((step) => <li key={step}>{step}</li>)}</ol></div>}
                  </article>;
                })}</div></div>

                <div className="editor-tone-picker"><span>Интонация результата</span><div>{styles.map((item) => <button type="button" className={adaptationTone === item ? "active" : ""} onClick={() => { setAdaptationTone(item); setAdaptationResult(null); setAdaptationMode("example"); }} key={item}>{item}</button>)}</div></div>

                <label className="adaptation-brand-switch"><input type="checkbox" checked={useBrand} onChange={(event) => setUseBrand(event.target.checked)}/><i/><span><b>Использовать профиль бренда</b><small>Можно отключить и работать только с исходным текстом</small></span></label>
                {adaptationError && <p className="generation-error" role="alert">{adaptationError}</p>}
                <button className={`button primary large adaptation-submit ${adaptationBusy ? "is-busy" : ""}`} type="button" onClick={adaptText} disabled={adaptationBusy || aiConnection !== "connected" || workspaceAccount.editorActionsRemaining <= 0}><Icon name="edit"/>{adaptationBusy ? "КЛИО редактирует…" : aiConnection !== "connected" ? "Сначала подключите ИИ" : workspaceAccount.editorActionsRemaining <= 0 ? "Лимит AI‑редактуры исчерпан" : `Запустить «${activeAdaptationPlan.title}»`}</button>
                <small className="adaptation-quota-note">Один запуск расходует одно редакторское действие. Ручное редактирование и копирование бесплатны.</small>
              </article>

              <article className={`adaptation-result-card ${adaptationResult ? "has-result" : "is-empty"}`}>
                <div className="adaptation-result-head"><div><span className={`status status-${adaptationMode}`}><i/>{adaptationMode === "ai" ? activeAdaptationPlan.title : adaptationMode === "demo" ? "Сохранённая версия" : aiConnection === "connected" ? "Ожидает исходник" : "ИИ не подключён"}</span><small>{adaptationResult ? `${adaptationResult.body.trim().split(/\s+/).filter(Boolean).length.toLocaleString("ru-RU")} слов · ${adaptationTone}` : "результат появится здесь"}</small></div>{adaptationResult && <button type="button" onClick={copyAdaptation}><Icon name="copy"/> Копировать</button>}</div>
                {adaptationResult ? <>
                  <AutoTextarea className="adaptation-result-title" rows={1} value={adaptationResult.title} onChange={(event) => setAdaptationResult((current) => current ? { ...current, title: event.target.value } : current)} aria-label="Заголовок адаптированного текста"/>
                  <AutoTextarea className="adaptation-result-body" value={adaptationResult.body} onChange={(event) => setAdaptationResult((current) => current ? { ...current, body: event.target.value } : current)} aria-label="Адаптированный текст"/>
                  <div className="adaptation-seo-fields"><label><span className="seo-field-label"><b>SEO‑заголовок</b><button type="button" onClick={() => copyPlainText(adaptationResult.metaTitle, "SEO‑заголовок")}><Icon name="copy"/> Копировать</button></span><AutoTextarea rows={1} value={adaptationResult.metaTitle} onChange={(event) => setAdaptationResult((current) => current ? { ...current, metaTitle: event.target.value } : current)}/></label><label><span className="seo-field-label"><b>Метаописание</b><button type="button" onClick={() => copyPlainText(adaptationResult.metaDescription, "Метаописание")}><Icon name="copy"/> Копировать</button></span><AutoTextarea rows={2} value={adaptationResult.metaDescription} onChange={(event) => setAdaptationResult((current) => current ? { ...current, metaDescription: event.target.value } : current)}/></label></div>
                  <aside className="adaptation-changes"><span>Что изменено</span><div>{adaptationResult.changes.map((item) => <p key={item}><i>✓</i>{item}</p>)}</div><small>{adaptationResult.editorialComment}</small></aside>
                  <div className="adaptation-result-footer"><span>Исходник остаётся слева для сравнения</span><button type="button" onClick={copyAdaptation}>Скопировать адаптированную версию ↗</button></div>
                </> : <div className="adaptation-empty-state"><i>Аа</i><h3>Вторая версия без потери фактов</h3><p>Выберите задачу и запустите редактуру. КЛИО не будет придумывать сведения, которых нет в исходном тексте или профиле бренда.</p><div><span>Исходник</span><b>→</b><span>Нужный формат</span></div></div>}
              </article>
            </div>
          </section>
        </section>
      </div>
      {toast && <div className="toast" role="status"><Icon name="check"/><span>{toast}</span></div>}
    </main>;
  }

  return <main className={`site-shell ${intro ? "intro-active" : ""}`}>
    <div className={`cover-intro ${intro ? "is-open" : "is-gone"}`} aria-hidden={!intro}>
      <div className="cover-shine"/><div className="cover-orbit orbit-one"/><div className="cover-orbit orbit-two"/>
      <div className="issue-line"><span>Цифровая редакция</span><span>№ 01 · 2026</span></div>
      <div className="intro-center"><div className="intro-title"><span>К</span><span>Л</span><span>И</span><span>О</span></div><p>Смысл. Стиль. Результат.</p></div>
      <button type="button" onClick={() => setIntro(false)}>Открыть редакцию <Icon name="arrow"/></button>
      <div className="intro-progress"><i/></div>
    </div>

    <header className="site-header">
      <a className="wordmark" href="#top" aria-label="КЛИО — на главную"><Brand/></a>
      <nav><a href="#audience">Для кого</a><a href="#modules">Как работает</a><a href="#plan">Контент‑план</a><a href="#pricing">Тарифы</a><a href="#faq">FAQ</a></nav>
      <div><Link className="button ghost" href="/login">Войти</Link><Link className="button primary" href="/signup">Попробовать</Link></div>
    </header>

    <section className="hero" id="top">
      <div className="hero-mast"><span>Независимая цифровая редакция</span><span>Выпуск 01 — 2026</span><span>Для бизнеса и агентств</span></div>
      <div className="hero-layout">
        <div className="hero-copy">
          <p className="eyebrow">Интеллектуальная платформа контента</p>
          <h1>Слова,<br/><em>которые видят.</em></h1>
          <p className="hero-lead">КЛИО исследует спрос, понимает голос бренда и создаёт цельные материалы — от замысла до публикации.</p>
          <div className="hero-actions"><Link className="button primary large" href="/workspace">Открыть редакцию <Icon name="arrow"/></Link><a href="#modules" className="text-link">Листать выпуск ↓</a></div>
        </div>
        <div className="hero-visual">
          <div className="visual-orbit"/>
          <div className="cover-story" aria-label="Пример готового материала"><span className="story-no">01</span><span className="story-label">Материал номера</span><h2>Как превратить<br/>поисковый запрос<br/><i>в историю бренда</i></h2><p>Аналитика на входе. Редакционный уровень на выходе.</p></div>
          <div className="floating-leaf leaf-one"><small>ГОЛОС БРЕНДА</small><b>Точно<br/>и узнаваемо</b><span>Профиль изучен ✓</span></div>
          <div className="floating-leaf leaf-two"><span>ПОИСКОВЫЙ СПРОС</span><b>8 420</b><small>запросов в месяц</small></div>
        </div>
      </div>
      <div className="scroll-cue"><i/> Листайте, чтобы открыть выпуск</div>
    </section>

    <div className="marquee"><div className="marquee-track"><MarqueeGroup/><MarqueeGroup hidden/></div></div>

    <section className="audience section" id="audience">
      <div className="section-heading audience-heading"><div><p className="kicker">КЛИО / Для кого</p><h2>Одна редакция.<br/><em>Разные задачи роста.</em></h2></div><p>Площадка подстраивается под ваш рабочий процесс: от первого экспертного материала до поточного производства контента для нескольких клиентов.</p></div>
      <div className="audience-grid">{audiences.map((item) => <article key={item.number}><span className="audience-number">{item.number}</span><div><h3>{item.title}</h3><p>{item.text}</p></div><strong>{item.result}</strong></article>)}</div>
    </section>

    <section className="showcase section" id="product">
      <div className="section-heading showcase-heading"><div><p className="kicker">Глава 01 / Образец редакции</p><h2>Так выглядит текст,<br/><em>готовый к публикации.</em></h2></div><p>Демонстрационный сценарий на примере санатория: слева — исходный бриф, справа — материал с редакционными инструментами и контролем результата.</p></div>
      <div className="showcase-studio">
        <aside className="showcase-brief" aria-label="Пример брифа материала">
          <div className="showcase-caption"><span>Демонстрация</span><small>Без запуска генерации</small></div>
          <div className="showcase-brand"><span>Профиль бренда</span><b>Санаторий «Марциальные воды»</b><small>marcwater.com · профиль активен</small></div>
          <div className="showcase-field"><span>Формат</span><div className="showcase-chips"><i className="active">Пост для соцсетей</i><i>SEO‑статья</i><i>Текст для сайта</i></div></div>
          <div className="showcase-field"><span>Тема материала</span><b>Дарсонвализация: польза процедуры и применение для кожи головы</b></div>
          <div className="showcase-meta"><div><span>Стиль</span><b>Экспертный</b></div><div><span>Объём</span><b>100 слов · свой</b></div></div>
          <Link className="button primary large" href="/workspace#generator">Создать свой материал <Icon name="arrow"/></Link>
        </aside>
        <article className="showcase-result" aria-label="Пример готового материала">
          <div className="showcase-result-head"><div><span><i/>Пример результата</span><small>95 / 100 слов · профиль бренда учтён</small></div><b>КЛИО / 01</b></div>
          <div className="showcase-paper">
            <span>Публикация для социальных сетей</span>
            <h3>Дарсонвализация: мягкий импульс для здоровья волос и кожи головы</h3>
            <p>Дарсонвализация — физиотерапевтическая процедура, в которой используют слабые импульсные токи высокой частоты. Воздействие проводят на разных участках тела: метод применяют в комплексных программах ухода за кожей, при мышечном напряжении и для поддержки местного кровообращения — строго по назначению специалиста.</p>
            <p>На фотографии врач работает с волосистой частью головы. Гребешковый электрод мягко перемещают по коже: пациент ощущает лёгкое покалывание и тепло. Процедуру могут включать в курс для улучшения питания кожи головы и ухода за волосами.</p>
            <p>Перед началом специалист оценивает показания и противопоказания и определяет продолжительность курса.</p>
            <p className="showcase-signature">С заботой о вас, санаторий «Марциальные воды» — первый российский курорт.</p>
          </div>
          <div className="showcase-tools" aria-label="Примеры редакционных действий"><button type="button" disabled>Сократить текст</button><button type="button" disabled>Сменить тон</button><button type="button" disabled>Адаптировать для VK</button><span>Инструменты доступны в кабинете</span></div>
        </article>
      </div>
      <p className="showcase-note">Это образец интерфейса и результата. Настройки здесь не изменяют текст — рабочая генерация находится в личном кабинете.</p>
    </section>

    <section className="modules section" id="modules">
      <div className="section-heading"><div><p className="kicker">Глава 02 / Полный цикл</p><h2>Не просто генерация.<br/><em>Система контента.</em></h2></div><p>Каждый модуль связан с остальными: данные компании и поисковой выдачи переходят в статьи, контент‑план и материалы для разных площадок.</p></div>
      <div className="module-grid">{modules.map(([number, moduleTitle, text]) => { const active = ["01", "02", "03", "04", "05", "06"].includes(number); return <article className={active ? "module-active" : ""} key={number}><span>{number}</span>{active && <b className="module-state">Работает в MVP</b>}<div className="module-icon">{number === "01" ? "Aa" : number === "02" ? "↗" : number === "03" ? "▦" : number === "04" ? "✦" : number === "05" ? "25" : "✓"}</div><h3>{moduleTitle}</h3><p>{text}</p><button type="button" onClick={() => openModule(number)}>Протестировать ↗</button></article>; })}</div>
    </section>

    <section className="plan-section" id="plan"><div className="plan-inner"><div className="plan-copy"><p className="kicker">Глава 03 / Контент‑план</p><h2>25 тем, которые<br/>работают на спрос.</h2><p>КЛИО объединяет поисковый интент, выбранную семантику и пробелы в контенте конкурентов. На выходе — готовая дорожная карта публикаций, а не список случайных идей.</p><ul><li><Icon name="check"/> SEO‑заголовок и метаописание</li><li><Icon name="check"/> Основной запрос и поддерживающая семантика</li><li><Icon name="check"/> Цель, аудитория, фактура и структура</li><li><Icon name="check"/> Статусы, передача в генератор и CSV</li></ul><button className="button light" type="button" onClick={() => openModule("05")}>Собрать контент‑план <Icon name="arrow"/></button></div><div className="plan-table"><div className="table-head"><b>Контент‑план / Август</b><span>Интент и приоритет</span></div>{[["01","Санаторное лечение в Карелии","Высокий","В работе"],["02","Как выбрать программу восстановления","Высокий","Готово"],["03","Минеральная вода: польза и показания","Средний","Запланировано"],["04","Лечебные грязи в санатории","Средний","Запланировано"],["05","Что взять с собой в санаторий","Доп.","Запланировано"]].map((row) => <div className="table-row" key={row[0]}><span>{row[0]}</span><b>{row[1]}</b><small>{row[2]}</small><i className={row[3] === "Готово" ? "done" : ""}>{row[3]}</i></div>)}</div></div></section>

    <section className="pricing section" id="pricing">
      <div className="section-heading pricing-heading"><div><p className="kicker">Глава 04 / Тарифы</p><h2>Выберите объём<br/><em>редакционной работы.</em></h2></div><div className="billing-toggle" role="group" aria-label="Период оплаты"><button type="button" className={!annual ? "active" : ""} onClick={() => setAnnual(false)}>Ежемесячно</button><button type="button" className={annual ? "active" : ""} onClick={() => setAnnual(true)}>За год <span>−20%</span></button></div></div>
      <div className="price-grid">{pricing.map((plan) => <article className={`price-card ${plan.popular ? "popular" : ""}`} key={plan.name}>{plan.popular && <span className="popular-label">Полный доступ</span>}<p className="price-index">КЛИО / {plan.name}</p><h3>{plan.name}</h3><p className="price-description">{plan.description}</p><div className="price"><strong>{(annual ? plan.yearly : plan.monthly).toLocaleString("ru-RU")} ₽</strong><span>/ месяц</span></div><small>{annual ? "при оплате за 12 месяцев" : "оплата помесячно"}</small><b className="plan-limit">{plan.limit}</b><ul>{plan.features.map((feature) => <li key={feature}><Icon name="check"/>{feature}</li>)}</ul><button className={`button ${plan.popular ? "primary" : "outline"}`} type="button" onClick={() => choosePlan(plan.name)}>Выбрать тариф</button></article>)}</div>
      <div className="payment-note"><span>МИР</span><span>СБП</span><span>₽</span><p>Оплата российскими картами и по СБП · документы для юридических лиц</p></div>
    </section>

    <section className="faq section" id="faq">
      <div className="section-heading faq-heading"><div><p className="kicker">Глава 05 / Вопросы и ответы</p><h2>Всё важное<br/><em>до первого выпуска.</em></h2></div><p>Коротко о том, как КЛИО работает с материалами, брендами и лимитами.</p></div>
      <div className="faq-list">{faq.map((item, index) => <details key={item.question} open={index === 0}><summary><span>{String(index + 1).padStart(2, "0")}</span><b>{item.question}</b><i aria-hidden="true">+</i></summary><p>{item.answer}</p></details>)}</div>
    </section>

    <section className="closing section">
      <div className="closing-layout">
        <div className="closing-copy"><p className="kicker">КЛИО / Цифровая редакция</p><h2>Ваш следующий выпуск<br/><em>начинается здесь.</em></h2><p>Создавайте материалы с пониманием бренда, спроса и аудитории — от идеи до публикации в одной редакции.</p><Link className="button primary large" href="/workspace">Создать первый материал <Icon name="arrow"/></Link></div>
        <div className="magazine-scene" aria-hidden="true"><div className="magazine-spread"><div className="magazine-page magazine-left"><span>КЛИО / 01</span><b>Слова,<br/>которые<br/><em>видят.</em></b><i>Цифровая редакция для бизнеса</i></div><div className="magazine-fold"/><div className="magazine-page magazine-right"><span>Материал номера</span><div className="magazine-photo"><u/><small>Спрос → смысл → публикация</small></div><p>Контент, собранный на основе данных и голоса вашего бренда.</p><strong>КЛИО</strong></div></div></div>
      </div>
    </section>
    <footer><a className="wordmark" href="#top"><Brand/></a><p>Контент‑платформа для бизнеса, экспертов и агентств.</p><nav><a href="#modules">Возможности</a><a href="#plan">Контент‑план</a><a href="#pricing">Тарифы</a></nav><small>© 2026 КЛИО</small></footer>
    {toast && <div className="toast" role="status"><Icon name="check"/><span>{toast}</span></div>}
  </main>;
}
