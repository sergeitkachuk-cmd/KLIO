import { AiResponseError, openAiErrorResponse } from "../_lib/openai-response";
import { CORE_SYSTEM_RULES, FINAL_QA_RULES } from "../../content-plans";
import { AiCallError, callAiModel } from "../_lib/ai-router";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";
import { claimAsyncJob, failAsyncJob, markAsyncJobProcessing, completeAsyncJob, recentCompletedContentPlanTitles } from "../_lib/async-jobs";
import { readWebsiteContext, websiteSourceLabel } from "../_lib/website-context";
import { researchContentPlanWeb } from "../_lib/tavily";
import { isAiRateLimited } from "../_lib/rate-limit";

type SemanticInput = {
  phrase: string;
  cluster: string;
  intent: string;
  breadth: string;
  relation: string;
  frequency: number;
};

type GeographyInput = {
  label: string;
  detail: string;
};

type BrandInput = {
  name: string;
  website: string;
  description: string;
  positioning: string;
  audience: string;
  advantages: string;
  products: string;
  services: string;
  proof: string;
  geography: string;
  voice: string;
  restrictions: string;
  prohibited: string;
  signature: string;
  vocabulary: string;
  cta: string;
};

type ContentPlanPayload = {
  query?: unknown;
  goal?: unknown;
  count?: unknown;
  semantics?: unknown;
  geography?: unknown;
  competitorInsights?: unknown;
  brand?: unknown;
  existingTitles?: unknown;
  newsAware?: unknown;
};

type ContentPlanGoal = "mixed" | "seo" | "social" | "landing" | "ads";

type PlanItem = {
  id: string;
  title: string;
  subtitle: string;
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
};

type AiPlan = {
  items: PlanItem[];
};

// A content plan is intentionally rich, but its first screen and the
// generator only need a compact editorial brief.  Letting a model expand
// every one of 25 rows into eight keywords, eight headings and eight fact
// requests turns a plan into a very large generation for little practical
// benefit.  These limits keep the result actionable and bound both output
// latency and the amount of JSON the provider has to assemble.
const PLAN_LSI_LIMIT = 4;
const PLAN_SEMANTICS_LIMIT = 24;
const PLAN_COMPETITOR_INSIGHTS_LIMIT = 5;
const PLAN_EXISTING_TITLES_LIMIT = 24;
const PLAN_WEBSITE_SNAPSHOT_LIMIT = 6_000;
const CONTENT_PLAN_TIMEOUT_MS = 120_000;
// Titles from completed plans older than this stop being a hard "never
// again" block and become soft context instead (still told to the model,
// worded as "revisit with a fresh angle" rather than "never repeat") — see
// recentCompletedContentPlanTitles' own comment for why: without this, a
// long-running subscription on a narrow niche eventually has no genuinely
// untouched ground left, and every regeneration fails outright.
const PLAN_STRICT_HISTORY_MS = 45 * 24 * 60 * 60 * 1000;
// A partial collision (1-2 of 15 titles touch recent history or each
// other) used to reject the entire batch and cost the whole generation.
// Instead, keep whatever validated cleanly and ask for only the shortfall,
// bounded to a few rounds so a genuinely stuck request still fails instead
// of looping forever.
const PLAN_MAX_GENERATION_ATTEMPTS = 3;
// How far ahead the model should look for professional/calendar occasions
// worth planning content around — long enough to cover realistic publishing
// lead time, short enough that "upcoming" still means something.
const PLAN_SEASONAL_HORIZON_DAYS = 60;

function contentPlanOutputTokenBudget(count: number) {
  if (count <= 10) return 4_500;
  if (count <= 15) return 6_500;
  return 10_000;
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = item.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanPlanTitle(value: string) {
  return value
    .replace(/^\s*(?:тема|заголовок|вариант|идея|инструкция|комментарий)\s*\d*\s*:\s*/i, "")
    .replace(/\s*\((?:комментарий|инструкция|пояснение|редакционная задача)[^)]*\)\s*$/gi, "")
    .replace(/\s*\[(?:комментарий|инструкция|пояснение|редакционная задача)[^\]]*\]\s*$/gi, "")
    .replace(/\s*[—–|]\s*(?:комментарий|инструкция|пояснение|редакционная задача)\b.*$/i, "")
    .trim();
}

function titleKey(value: string) {
  return cleanPlanTitle(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

const TITLE_STOP_WORDS = new Set(["и", "в", "во", "на", "для", "по", "как", "что", "это", "или", "из", "от", "до", "при", "о", "об", "а", "не", "ли"]);

function titleTerms(value: string) {
  return new Set(value.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ")
    .map((word) => word.replace(/(?:иями|ями|ами|ого|ему|ыми|ими|иях|иях|ия|ий|ый|ой|ая|ое|ое|ам|ям|ах|ях|ов|ев|ом|ем|а|ы|и|у|е|о|я)$/u, ""))
    .filter((word) => word.length >= 4 && !TITLE_STOP_WORDS.has(word)));
}

function titlesAreTooSimilar(left: string, right: string) {
  if (titleKey(left) === titleKey(right)) return true;
  const a = titleTerms(left);
  const b = titleTerms(right);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  // A ratio alone breaks down for short titles: two titles that merely
  // share their subject's 2 core nouns (e.g. both mention "санаторий" and
  // "лечение") hit a 100% ratio at min-size 2 even though they're about
  // completely different things — everything that would actually
  // distinguish them (numbers, short qualifiers) is already discarded by
  // the length>=4/stopword filter above. Confirmed via simulation while
  // investigating a "content plan totally fails, every attempt" report:
  // a batch of 15 short, topically-related titles saw most of them flagged
  // as mutual duplicates purely from this effect. Requiring at least 3
  // shared terms keeps real near-duplicates caught (which in practice
  // share most of a full sentence, not just its subject) while two titles
  // that merely share what they're about do not.
  if (shared < 3) return false;
  return shared / Math.min(a.size, b.size) >= 0.67;
}

function isCurrentIndustryFocus(query: string) {
  return /(?:актуальн|тренд|отрасл|рын(?:ок|очн)|новост|изменени|тенденц)/iu.test(query);
}

const CONTENT_PLAN_GOALS = new Set<ContentPlanGoal>(["mixed", "seo", "social", "landing", "ads"]);

function normalizePayload(raw: ContentPlanPayload) {
  const requestedQuery = clean(raw.query, 300);
  const requestedGoal = clean(raw.goal, 20) as ContentPlanGoal;
  const goal = CONTENT_PLAN_GOALS.has(requestedGoal) ? requestedGoal : "mixed";
  const countValue = Number(raw.count);
  const count = [10, 15, 25].includes(countValue) ? countValue : 15;
  const semantics = Array.isArray(raw.semantics) ? raw.semantics.slice(0, 40).map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      phrase: clean(source.phrase, 240),
      cluster: clean(source.cluster, 120) || "Основная тема",
      intent: clean(source.intent, 80),
      breadth: clean(source.breadth ?? source.demand, 80),
      relation: clean(source.relation, 80),
      frequency: Math.max(0, Math.min(100_000_000, Number(source.frequency) || 0)),
    } satisfies SemanticInput;
  }).filter((item) => item.phrase) : [];
  const geography = Array.isArray(raw.geography) ? raw.geography.slice(0, 12).map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { label: clean(source.label, 140), detail: clean(source.detail, 180) } satisfies GeographyInput;
  }).filter((item) => item.label) : [];
  const competitorInsights = Array.isArray(raw.competitorInsights)
    ? raw.competitorInsights.map((item) => clean(item, 300)).filter(Boolean).slice(0, 8)
    : [];
  const sourceBrand = raw.brand && typeof raw.brand === "object" ? raw.brand as Record<string, unknown> : {};
  const brand = {
    name: clean(sourceBrand.name, 160),
    website: clean(sourceBrand.website, 220),
    description: clean(sourceBrand.description, 2200),
    positioning: clean(sourceBrand.positioning, 1600),
    audience: clean(sourceBrand.audience, 1200),
    advantages: clean(sourceBrand.advantages, 2600),
    products: clean(sourceBrand.products, 1800),
    services: clean(sourceBrand.services, 1800),
    proof: clean(sourceBrand.proof, 1800),
    geography: clean(sourceBrand.geography, 600),
    voice: clean(sourceBrand.voice, 1200),
    restrictions: clean(sourceBrand.restrictions, 1200),
    prohibited: clean(sourceBrand.prohibited, 1200),
    signature: clean(sourceBrand.signature, 700),
    vocabulary: clean(sourceBrand.vocabulary, 1200),
    cta: clean(sourceBrand.cta, 500),
  } satisfies BrandInput;
  const query = requestedQuery || [brand.name, brand.positioning || brand.description].filter(Boolean).join(": ").slice(0, 300);
  // Was 120 — for an account with a long history this dumped a huge
  // "don't repeat any of these" list straight into the prompt. Confirmed
  // via the diagnostic logging added to ai-router.ts: DeepSeek's own
  // reasoning trace on a stuck request explicitly said "the existing list
  // is very long and covers most brand topics" and spent enormous effort
  // brainstorming around it, chewing through the token budget on
  // reasoning/search without ever reaching the final message. The client
  // sends this newest-first (see existingTitles in buildContentPlan),
  // so capping here still keeps the titles most likely to actually
  // collide with a fresh plan.
  const existingTitles = unique(Array.isArray(raw.existingTitles)
    ? raw.existingTitles.map((item) => clean(item, 240)).filter(Boolean).slice(0, PLAN_EXISTING_TITLES_LIMIT)
    : []);
  // User-facing "Учитывать актуальные новости отрасли" checkbox — forces
  // the same current-industry-focus mode isCurrentIndustryFocus otherwise
  // only reaches by guessing at keywords in the query text.
  const newsAware = raw.newsAware === true;
  return { query, requestedQuery, goal, count, semantics, geography, competitorInsights, brand, existingTitles, newsAware };
}

const itemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    subtitle: { type: "string" },
    cluster: { type: "string" },
    format: { type: "string", enum: ["SEO‑статья", "Экспертный разбор", "FAQ", "Сравнение", "Кейс", "Посадочная страница", "Рекламный текст", "Пост"] },
    intent: { type: "string", enum: ["Информационный", "Коммерческий", "Транзакционный", "Смешанный", "Навигационный"] },
    stage: { type: "string", enum: ["Знакомство", "Выбор", "Решение", "Удержание"] },
    priority: { type: "string", enum: ["Высокий", "Средний", "Дополнительный"] },
    angle: { type: "string" },
    objective: { type: "string" },
    primaryKeyword: { type: "string" },
  },
  // The model returns only a compact editorial core. The remaining display
  // fields are deterministic derivatives below; asking it to write them for
  // every row was the source of max_output_tokens truncation on DeepSeek.
  required: ["id", "title", "subtitle", "cluster", "format", "intent", "stage", "priority", "angle", "objective", "primaryKeyword"],
  additionalProperties: false,
} as const;

function contentPlanSchema(count: number) {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: itemSchema,
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
}

// What formats "mixed" is allowed to reach for, and what every other
// goal locks the whole plan down to — kept in one place so the prompt
// instruction and the post-generation check below can't drift apart.
const GOAL_FORMAT_LOCK: Record<ContentPlanGoal, PlanItem["format"][]> = {
  mixed: ["SEO‑статья", "Экспертный разбор", "FAQ", "Сравнение", "Кейс", "Посадочная страница", "Рекламный текст", "Пост"],
  seo: ["SEO‑статья", "Экспертный разбор", "FAQ", "Сравнение", "Кейс"],
  social: ["Пост"],
  landing: ["Посадочная страница"],
  ads: ["Рекламный текст"],
};

const GOAL_INSTRUCTION: Record<ContentPlanGoal, string> = {
  mixed: "Свободно распределяй формат каждой темы (SEO‑статья, Экспертный разбор, FAQ, Сравнение, Кейс, Посадочная страница, Рекламный текст, Пост) по её месту в воронке.",
  seo: "Обязательное ограничение: формат каждой темы — только SEO‑статья, Экспертный разбор, FAQ, Сравнение или Кейс. План собирается для блога/сайта; не используй Посадочную страницу, Рекламный текст или Пост.",
  social: "Обязательное ограничение: формат каждой темы — только «Пост». План собирается как календарь публикаций для соцсетей, а не для сайта или рекламы.",
  landing: "Обязательное ограничение: формат каждой темы — только «Посадочная страница». План собирается как набор продающих лендингов, а не блог, соцсети или реклама.",
  ads: "Обязательное ограничение: формат каждой темы — только «Рекламный текст». План собирается как набор коротких рекламных текстов, а не блог, лендинги или соцсети.",
};

function availablePlanSources(input: ReturnType<typeof normalizePayload>, websiteLoaded: boolean, webResearchLoaded: boolean) {
  return [
    input.requestedQuery ? "Тема" : "",
    input.semantics.length ? "Семантика" : "",
    input.geography.length ? "География" : "",
    input.competitorInsights.length ? "Матрица" : "",
    input.brand.name ? "Профиль бренда" : "",
    websiteLoaded ? "Сайт бренда" : "",
    webResearchLoaded ? "Веб-поиск" : "",
  ].filter(Boolean);
}

type PlanItemEvaluation = {
  // Cleanly validated items only — never includes a duplicate/repeat/
  // invalid one, so a caller can always safely use this as-is.
  valid: PlanItem[];
  countMismatch: boolean;
  duplicateTitles: string[];
  repeatsExistingTitles: string[];
  invalidTitles: string[];
};

// Was "validatePlan" and threw on any collision, discarding the whole
// batch — one bad title out of 15 cost the entire generation (and, on a
// long-running subscription, made every regeneration more likely to fail
// as history piled up: site owner report). Now returns whatever validated
// cleanly instead of throwing, so runContentPlanGeneration can keep the
// good items and ask for only the shortfall — see the retry loop there.
function evaluatePlanItems(plan: AiPlan, expectedCount: number, excludeTitles: string[], goal: ContentPlanGoal, brand: BrandInput, sources: string[]): PlanItemEvaluation {
  if (!Array.isArray(plan.items) || plan.items.length !== expectedCount) {
    return { valid: [], countMismatch: true, duplicateTitles: [], repeatsExistingTitles: [], invalidTitles: [] };
  }

  const cleaned = plan.items.map((item) => ({
    ...item,
    id: "",
    title: cleanPlanTitle(clean(item.title, 220)),
    subtitle: clean(item.subtitle, 360),
    cluster: clean(item.cluster, 100),
    angle: clean(item.angle, 500),
    objective: clean(item.objective, 500),
    primaryKeyword: clean(item.primaryKeyword, 220),
    lsi: unique([clean(item.primaryKeyword, 180), clean(item.cluster, 180)]).slice(0, PLAN_LSI_LIMIT),
    audience: brand.audience || "Читатели, выбирающие решение по теме материала",
    metaTitle: cleanPlanTitle(clean(item.title, 90)),
    metaDescription: clean(item.subtitle, 190),
    structure: ["Контекст и вопрос читателя", "Ключевые факты и критерии выбора", "Практический ориентир по теме", "Следующий шаг"],
    cta: brand.cta || "Узнать подробности и получить консультацию.",
    evidenceNeeded: ["Проверить актуальные факты и данные перед публикацией"],
    // Sources are deterministic metadata about this request, not creative
    // content.  Filling them here saves one array per plan row and prevents
    // the model from inventing a source that was never supplied.
    sources,
  }));

  const duplicates = cleaned.filter((item, index) => cleaned.slice(0, index).some((previous) => titlesAreTooSimilar(previous.title, item.title)));
  const repeatsExisting = cleaned.filter((item) => excludeTitles.some((title) => titlesAreTooSimilar(title, item.title)));
  const allowedFormats = GOAL_FORMAT_LOCK[goal];
  const invalid = cleaned.filter((item) => (
    !item.title || !item.cluster || !item.primaryKeyword || !item.angle || !item.objective
    || item.lsi.length < 2 || item.structure.length < 3
    || !allowedFormats.includes(item.format)
    || /(?:комментарий пользователя|редакционн(?:ая|ый) задач|используй|добавь|раскрой применительно|инструкц(?:ия|ии) для ии)/i.test(item.title)
  ));

  const badKeys = new Set([...duplicates, ...repeatsExisting, ...invalid].map((item) => item.title));
  return {
    valid: cleaned.filter((item) => !badKeys.has(item.title)),
    countMismatch: false,
    duplicateTitles: duplicates.map((item) => item.title),
    repeatsExistingTitles: repeatsExisting.map((item) => item.title),
    invalidTitles: invalid.map((item) => item.title),
  };
}

// The actual AI call + validation + quota debit, extracted out of the
// route handler so it can run after the response has already gone back
// to the client (see async-jobs.ts for why that's safe on this host).
async function runContentPlanGeneration(input: ReturnType<typeof normalizePayload>, ownerEmail: string, jobId?: string) {
  const historicalTitles = await recentCompletedContentPlanTitles(ownerEmail, PLAN_EXISTING_TITLES_LIMIT);
  const historyCutoffMs = Date.now() - PLAN_STRICT_HISTORY_MS;
  const recentHistoricalTitles = historicalTitles.filter((item) => new Date(item.createdAt).getTime() >= historyCutoffMs).map((item) => item.title);
  // Older than the cutoff: told to the model as "revisit with a fresh
  // angle if enough time has passed", never enforced as a hard reject —
  // see evaluatePlanItems, which only ever checks against strictExcludeBase
  // below, not this list.
  const softExcludeTitles = unique(historicalTitles.filter((item) => new Date(item.createdAt).getTime() < historyCutoffMs).map((item) => item.title)).slice(0, PLAN_EXISTING_TITLES_LIMIT);
  // Client-sent existingTitles are always "right now" (the plan currently
  // on screen, being explicitly refreshed) — always strict, same as recent
  // history.
  const strictExcludeBase = unique([...input.existingTitles, ...recentHistoricalTitles]).slice(0, PLAN_EXISTING_TITLES_LIMIT);
  input = { ...input, existingTitles: strictExcludeBase };
  // The "Учитывать актуальные новости отрасли" checkbox forces the same
  // mode isCurrentIndustryFocus otherwise only reaches by matching keywords
  // in the query text — same single researchContentPlanWeb call either
  // way, just a different query framing, so this adds no extra web-search
  // cost over what a "актуальные темы" query already triggers.
  const currentIndustryFocus = input.newsAware || isCurrentIndustryFocus(input.query);
  // Direct HTTP read of the brand's own site (not an AI call). A separate
  // AI research/web-search step was tried here and reverted — see the fix
  // history in ai-config.ts's generate_content_plan entry for why.
  // Both reads are independent and bounded.  They run concurrently, then
  // DeepSeek gets their compact results as plain input — never a web tool.
  const [website, webResearch] = await Promise.all([
    input.brand.website ? readWebsiteContext(input.brand.website) : Promise.resolve(null),
    researchContentPlanWeb(input.query, input.geography, currentIndustryFocus),
  ]);
  const sources = availablePlanSources(input, website?.status === "loaded", Boolean(webResearch));

  function buildInstructions(neededCount: number, excludeTitles: string[]) {
    return [
      "Ты — ведущий контент‑стратег и SEO‑редактор платформы КЛИО.",
      ...CORE_SYSTEM_RULES,
      "Работай как редакционная система бренда, а не генератор общих заголовков. Сначала используй весь доступный профиль: предложение, аудиторию, позиционирование, подтверждённые преимущества, доказательства, географию, голос и ограничения.",
      input.requestedQuery ? "Основная тема пользователя задаёт фокус плана; не выходи за неё без явной связи с брендом." : "Отдельная тема и семантика не заданы: построй разнообразный общий контент‑план вокруг отрасли и задач аудитории, а не каталог бренда. Расширяй поле от услуг бренда к близким проблемам, критериям выбора, подготовке, использованию, уходу, типичным ошибкам, смежным решениям и экспертным вопросам, которые могут привести новую аудиторию. Не сужай план до одного преимущества или одной услуги.",
      currentIndustryFocus ? "Пользователь просит актуальные отраслевые темы. Это приоритет выше перечня программ на сайте: минимум 60% плана посвяти внешнему отраслевому полю — подтверждённым веб‑поиском изменениям, трендам, ожиданиям аудитории, новым практикам и значимым вопросам отрасли. Сайт бренда используй только для проверки релевантности и мягкой связи с предложением; не подменяй отраслевой план каталогом услуг. Не выдумывай новости, даты, тренды или регулирование: если этого нет в web_research, формулируй тему как вопрос или критерий выбора без заявления о факте." : "",
      // Универсальное правило для любого бренда и отрасли: тема/фокус часто
      // называет категорию, а не одну конкретную тему ("акцент на
      // программах лечения", "по каждой услуге", "линейка продуктов",
      // "виды процедур") — без этого правила модель просто держала
      // категорию в уме как общий вектор и выдавала разноплановые темы
      // вокруг неё, а не по одной теме на каждый пункт категории, чего
      // ожидал пользователь.
      "Если тема или фокус называет категорию из нескольких пунктов без явного перечисления самих пунктов (например: «акцент на программах лечения», «по каждой услуге», «наши направления», «линейка продуктов», «виды процедур»), сначала определи конкретные пункты этой категории — в первую очередь по продуктам и услугам из профиля бренда, если они там названы; если в профиле их нет, опирайся на типичные пункты такой категории в этой отрасли, не приписывая бренду недостоверные детали. Затем построй план так, чтобы каждый пункт (или большинство пунктов, если их больше, чем тем в плане) получил отдельную тему со своим углом и практической пользой, а не растворялся в одном общем обзоре.",
      `Создай ровно ${neededCount} готовых к работе тем для единой контент‑системы, а не перечень шаблонных заголовков.`,
      GOAL_INSTRUCTION[input.goal],
      "Сначала определи предмет, аудиторию, поисковые интенты, коммерческую задачу и возможные тематические ветви. Не переносить знания или шаблоны из другой отрасли.",
      "Разведи ядро, широкие обзоры, средние подтемы, узкие long-tail вопросы и действительно смежные темы. Смежная тема должна поддерживать решение аудитории или экспертизу бренда, а не быть случайной ассоциацией.",
      input.semantics.length
        ? "Семантика — это карта реального спроса для серии публикаций, а не набор ключей одной статьи. Построй план по её кластерам: одна строка плана использует один кластер и один поисковый интент; основной запрос и все поддерживающие формулировки строки должны относиться к этому же кластеру. Не смешивай кластеры в одном материале. Один кластер можно развить несколькими материалами только для явно разных вопросов или интентов, без каннибализации."
        : "Семантика не передана: построй план по теме и профилю, но не выдумывай частотность запросов.",
      input.semantics.length
        ? "В первую очередь используй небрендовые, широкие и смежные кластеры, чтобы приводить новую аудиторию. Брендовые, навигационные и запросы вида «официальный сайт», «цены» оставляй для отдельных конверсионных страниц или материалов только когда это прямо соответствует цели плана; не подменяй ими статьи для роста новой аудитории. Частотность — сигнал приоритета среди сопоставимых кластеров, но не единственный критерий: учитывай интент, полезность и соответствие бренду."
        : "Без семантики проведи веб‑исследование тематического поля и предложи околоотраслевые, околотематические и полезные для новой аудитории направления. Не выдумывай частотность и не делай все темы брендовыми. Уместные календарные поводы и праздники можно включать только если они действительно связаны с предложением, аудиторией или сезонным спросом бренда и дают читателю самостоятельную пользу. Не добавляй формальные поздравления, случайные даты и выдуманную сезонность.",
      // Explicit permission, not just tolerance: a genuinely seasonal theme
      // recurring every year is good editorial practice, not a duplicate —
      // the hard exclusion list below only ever contains recent titles, so
      // this only needs to unblock the model's own judgment, not fight a
      // stricter check downstream.
      // Without today's actual date, the model has no grounded way to know
      // what season/quarter it is or which professional/calendar days fall
      // within publishing lead time — it either invents dates (forbidden
      // elsewhere in this prompt) or, more often, just plays safe and skips
      // seasonal angles entirely. current_date in the input JSON below is
      // the fix (site owner: real, verifiable occasions relevant to the
      // brand's own field were being missed entirely, e.g. World PT Day for
      // a sanatorium/rehab brand).
      `Сегодняшняя дата передана в current_date (поле input). Используй её, чтобы определить текущий сезон, время года и ближайшие ${PLAN_SEASONAL_HORIZON_DAYS} дней — включай темы к отраслевым профессиональным дням, праздникам или сезонным поводам этого периода, если они реально существуют и относятся к отрасли или аудитории бренда (например, Всемирный день физиотерапевта для санатория/реабилитации). Называй только те памятные даты и праздники, в существовании которых ты уверен — при любом сомнении в дате или названии не выдумывай её, сформулируй тему без привязки к конкретному дню.`,
      "Сезонные и календарные темы поощряются, если они реально востребованы аудиторией или отраслью бренда (сезон спроса, отраслевые события, актуальные для времени года вопросы) — такая тема, поднятая год назад, разрешена снова: сезон вернулся, читатель другой. Не путай уместный сезонный повод с формальным поздравлением или случайной датой.",
      "Сбалансируй воронку: знакомство, выбор, решение и удержание. Не делай весь план информационными инструкциями и не превращай коммерческие темы в статьи «как выбрать». Для темы с конкретным брендом или продуктом предусмотрены материалы о его предложении, доказательствах, сценариях применения и возражениях.",
      // Универсальный пробел для любого бренда: план легко скатывается в
      // одну лишь предметную экспертизу (сама услуга/продукт) и упускает
      // тему взаимодействия с самим сервисом — то, как клиенту удобно
      // записаться, оформить заказ, воспользоваться личным кабинетом или
      // подготовиться к визиту. Это тоже реальная задача аудитории и
      // материал для «Удержание»/поддержки, а не только для «Решение».
      "Кроме предметной экспертизы включи материалы про взаимодействие с самим сервисом бренда, если это уместно отрасли: как записаться или оформить заявку, чем удобны онлайн‑бронирование, личный кабинет или другие сервисы сайта, что взять с собой или как подготовиться, чего ожидать на месте, как связаться с поддержкой. Не выдумывай функции сайта, которых нет в профиле бренда или website_snapshot — если таких сведений нет, опирайся на типичный процесс отрасли в общих чертах, не приписывая бренду конкретные технические детали.",
      "Если тема или фокус не указывает на конкретную категорию для разбора по пунктам (см. правило выше), не строй план вокруг одного преимущества и не превращай его в скучный каталог услуг без содержания. Разделяй образовательные, коммерческие, репутационные и вовлекающие задачи; не выдумывай сезонность, статистику, тренды или кейсы.",
      "Каждый title — чистый публикационный заголовок без номера, комментария, редакционной команды, пояснения в скобках и фраз вроде «использовать выводы». Не добавляй одинаковые каркасы «полный разбор», «основные ошибки», «пошаговый маршрут» ко всем темам.",
      // The recurring complaint this addresses: a plan where most titles
      // open the same way ("Почему...", "Когда...", "Как...") reads as
      // repetitive even when the underlying topics genuinely differ — title
      // *pattern* is its own diversity axis, separate from topic/cluster
      // diversity already required above.
      "Заголовки должны различаться и по смыслу, и по форме написания. Не начинай больше 2-3 заголовков одинаковой конструкцией («Почему…», «Когда…», «Как…», «Что такое…» и т.п.) — смешивай утверждения, вопросы, сравнения («X или Y»), числовые форматы («5 признаков…», «3 ошибки…»), предупреждения и практические разборы. Если самопроверка показывает, что многие заголовки начинаются одинаково — переформулируй часть из них другой конструкцией, сохранив тему.",
      excludeTitles.length ? `Это уже созданные темы и материалы бренда за последнее время. Не повторяй их, не делай близкие перефразировки и не возвращай ту же задачу с переставленными словами: ${excludeTitles.map((title) => `«${title}»`).join("; ")}` : "Если ранее созданные темы не переданы, всё равно не повторяй идеи внутри текущего плана.",
      softExcludeTitles.length ? `Эти темы поднимались раньше, но прошло достаточно времени: ${softExcludeTitles.map((title) => `«${title}»`).join("; ")}. Их можно взять снова только с действительно новым ракурсом, актуальным поводом или обновлёнными фактами — не пересказывай их дословно той же структурой.` : "",
      "Для каждой строки верни только title, subtitle, cluster, format, intent, stage, priority, angle, objective и primaryKeyword. Не выводи lsi, audience, metaTitle, metaDescription, structure, cta, evidenceNeeded или sources: КЛИО заполнит их из профиля и темы. Формулируй поля кратко и по существу.",
      "Title и subtitle должны точно соответствовать теме. subtitle — одна короткая зацепка под H1 с пользой читателю, не повторяет title. Не обещай позиции, результат лечения, доход, сроки, цены и иные факты, которых нет в источниках.",
      "Сначала продумай задачу читателя и редакционный ракурс, но во внешний JSON выведи только компактную схему. Не добавляй объяснений вне JSON.",
      // A separate AI research/web-search step (and, briefly, routing this
      // whole operation to OpenAI) was tried and reverted here — see the
      // fix history in ai-config.ts's generate_content_plan entry.
      "Опирайся на переданный профиль бренда, семантику, географию и снимок сайта бренда (website_snapshot) — не выдумывай факты, частотность или подробности, которых там нет. Если website_snapshot содержит актуальные предложения, программы или обновления, которых нет в текстовых полях профиля, обязательно учти их — это самый свежий источник о том, что бренд предлагает прямо сейчас.",
      "Не пиши промежуточные текстовые сообщения о ходе работы («приступаю к анализу», «теперь перейду к плану» и т.п.). Единственный текстовый ответ — финальный JSON с готовым планом.",
      "Верни только структурированный результат по заданной JSON‑схеме.",
      ...FINAL_QA_RULES,
    ].join("\n");
  }

  function buildRequestInput(neededCount: number, excludeTitles: string[]) {
    const now = new Date();
    return JSON.stringify({
      current_date: now.toISOString().slice(0, 10),
      current_date_human: now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Europe/Moscow" }),
      seasonal_planning_horizon_days: PLAN_SEASONAL_HORIZON_DAYS,
      main_topic: input.query,
      focus_mode: currentIndustryFocus ? "current_industry_topics" : "brand_or_general_topic",
      plan_basis: input.requestedQuery ? "user_topic" : "brand_profile",
      plan_goal: input.goal,
      allowed_formats: GOAL_FORMAT_LOCK[input.goal],
      selected_semantics: input.semantics.slice(0, PLAN_SEMANTICS_LIMIT),
      semantic_strategy: input.semantics.length ? {
        purpose: "series_of_articles_for_new_audience",
        article_rule: "one article equals one semantic cluster and one intent",
        prioritize: "non_brand_broad_and_related_demand",
        separate: "brand_navigation_and_conversion_demand",
        frequency: "verified monthly demand; use only to prioritize, never invent it",
      } : {
        purpose: "broad_industry_content_field_without_semantics",
        prioritize: "audience problems, adjacent topics, expert questions and new-audience entry points",
        seasonal_content: "include only genuinely relevant verified dates or holidays with useful angle; never use generic greetings",
        prohibition: "do not invent search volume, seasonality or brand facts",
      },
      search_geography: input.geography,
      competitor_editorial_opportunities: input.competitorInsights.slice(0, PLAN_COMPETITOR_INSIGHTS_LIMIT),
      brand_profile: input.brand.name ? input.brand : null,
      website_snapshot: website && website.status === "loaded"
        ? { url: website.resolvedUrl, text: website.text.slice(0, PLAN_WEBSITE_SNAPSHOT_LIMIT) }
        : null,
      web_research: webResearch ? {
        query: webResearch.query,
        results: webResearch.results,
        rule: currentIndustryFocus ? "Это первичный источник для выбора актуальных отраслевых ракурсов. Не приписывай бренду факты из чужих сайтов и не выдумывай данные." : "Это краткие выдержки поиска. Используй их только как ориентир для актуальности и тематики; не приписывай бренду факты из чужих сайтов и не выдумывай данные.",
      } : null,
      existing_titles_to_exclude: excludeTitles,
      existing_titles_soft_reference: softExcludeTitles,
      editorial_brief_contract: {
        topic: "title", subtitle: "subtitle", intent: "intent", objective: "objective", audience: "audience", angle: "angle", format: "format",
        structure: "structure", keywords: ["primaryKeyword", "lsi"], evidenceNeeded: "evidenceNeeded", sources: "sources",
        knownFacts: input.brand.name ? [input.brand.description, input.brand.positioning, input.brand.advantages, input.brand.products, input.brand.services, input.brand.proof].filter(Boolean) : [],
        restrictions: [input.brand.restrictions, input.brand.prohibited].filter(Boolean),
        authorPosition: "brand for commercial brand materials; neutral or expert otherwise",
      },
      required_items: neededCount,
    }, null, 2);
  }

  // A partial collision (1-2 of N titles touch recent history or each
  // other) used to reject the entire batch, costing the whole generation
  // and, on a long-running subscription, getting more likely every time as
  // history piled up (site owner report). Now: keep whatever validated
  // cleanly and ask only for the shortfall, bounded to
  // PLAN_MAX_GENERATION_ATTEMPTS rounds so a genuinely stuck request still
  // fails instead of looping forever or ballooning cost.
  let accepted: PlanItem[] = [];
  let excludeTitles = strictExcludeBase;
  let model = "";
  for (let attempt = 1; attempt <= PLAN_MAX_GENERATION_ATTEMPTS && accepted.length < input.count; attempt++) {
    const neededCount = input.count - accepted.length;
    const call = await callAiModel<AiPlan>({
      operation: "generate_content_plan",
      maxOutputTokensOverride: contentPlanOutputTokenBudget(neededCount),
      requestTimeoutMs: CONTENT_PLAN_TIMEOUT_MS,
      ownerEmail,
      schemaName: "klio_content_plan",
      schema: contentPlanSchema(neededCount),
      instructions: buildInstructions(neededCount, excludeTitles),
      input: buildRequestInput(neededCount, excludeTitles),
    });
    model = call.model;
    const evaluation = evaluatePlanItems(call.result, neededCount, excludeTitles, input.goal, input.brand, sources);
    accepted = [...accepted, ...evaluation.valid];
    excludeTitles = unique([...excludeTitles, ...evaluation.valid.map((item) => item.title)]);
    if (evaluation.countMismatch || evaluation.duplicateTitles.length || evaluation.repeatsExistingTitles.length || evaluation.invalidTitles.length) {
      // Was a silent discard with zero trace — logged now so a rejection
      // is diagnosable from real data instead of another guess (site
      // owner: hit this five times in a row with no way to tell why).
      console.error("content-plan validation rejected part of the AI's output", JSON.stringify({
        attempt, neededCount, acceptedSoFar: accepted.length,
        countMismatch: evaluation.countMismatch,
        duplicateTitles: evaluation.duplicateTitles,
        repeatsExistingTitles: evaluation.repeatsExistingTitles,
        invalidTitles: evaluation.invalidTitles,
        excludeTitlesChecked: excludeTitles,
      }));
    }
  }

  if (accepted.length < input.count) {
    throw new AiResponseError("AI‑редакция подготовила слабый или повторяющийся контент‑план. Запустите анализ ещё раз.", 422);
  }
  const items = accepted.slice(0, input.count).map((item, index) => ({ ...item, id: `plan-${index + 1}` }));
  const baseDataNote = input.semantics.length
    ? "План построен по карте подтверждённого спроса: каждая тема привязана к одному кластеру и отдельной задаче читателя. В приоритете — небрендовые и смежные запросы для привлечения новой аудитории; брендовый спрос вынесен в отдельную конверсионную ветку."
    : "План создан AI‑стратегом по текущей теме и подключённым источникам. Подключите семантику, чтобы приоритизировать темы по подтверждённому спросу.";
  // Visible confirmation of whether the direct site read actually worked
  // (best-effort — a failed/blocked fetch just means no note, not an error).
  const groundingNote = [
    website?.status === "loaded" ? `Сайт бренда прочитан (${websiteSourceLabel(website)}).` : "",
    webResearch ? "Веб-поиск Tavily выполнен в ограниченном режиме и добавлен как справочный слой." : "",
  ].filter(Boolean).join(" ");
  const result = {
    mode: "ai" as const,
    model,
    result: {
      query: input.query,
      items,
      clusters: unique(items.map((item) => item.cluster)),
      dataNote: `${baseDataNote}${groundingNote ? ` ${groundingNote}` : ""}`,
    },
  };
  const usage = await recordResearch(jobId ? { id: jobId, result } : undefined);
  return { ...result, usage };
}

// Runs the generation in the background and writes the outcome to the job
// row — never thrown/awaited by the route handler that kicks it off.
async function runContentPlanJob(jobId: string, input: ReturnType<typeof normalizePayload>, ownerEmail: string) {
  try {
    await markAsyncJobProcessing(jobId);
    const payload = await runContentPlanGeneration(input, ownerEmail, jobId);
    await completeAsyncJob(jobId, payload);
  } catch (error) {
    const message = error instanceof WorkspaceAccessError || error instanceof AiResponseError || error instanceof AiCallError
      ? error.message
      : "Не удалось собрать контент‑план. Проверьте исходные данные и повторите попытку.";
    if (!(error instanceof WorkspaceAccessError)) console.error("content-plan background job failed", error);
    await failAsyncJob(jobId, message);
  }
}

export async function POST(request: Request) {
  try {
    if (isAiRateLimited(request, "content-plan", 2)) return Response.json({ error: "Слишком много запусков контент-плана подряд. Подождите минуту и повторите." }, { status: 429 });
    const raw = await request.json() as ContentPlanPayload;
    const input = normalizePayload(raw);
    if (!input.query) return Response.json({ error: "Укажите тему или заполните название и основу профиля бренда." }, { status: 400 });
    // Checked up front, synchronously, so an account that's already over
    // its limit gets a clean 429 immediately instead of a job that's
    // created only to fail a few seconds later.
    await assertSecondaryQuotaAvailable("research");
    const identity = await workspaceIdentity();
    const job = await claimAsyncJob("content_plan", identity.email, input, CONTENT_PLAN_TIMEOUT_MS + 10_000);
    if (job.reused) return Response.json({ jobId: job.id, reused: true });
    const jobId = job.id;
    // Intentionally not awaited — see async-jobs.ts for why this keeps
    // running after the response below is sent on this host.
    void runContentPlanJob(jobId, input, identity.email);
    return Response.json({ jobId });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось запустить сборку контент‑плана.");
  }
}
