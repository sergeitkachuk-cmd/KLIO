import { AiResponseError, openAiErrorResponse } from "../_lib/openai-response";
import { CORE_SYSTEM_RULES, FINAL_QA_RULES } from "../../content-plans";
import { AiCallError, callAiModel } from "../_lib/ai-router";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";
import { createAsyncJob, failAsyncJob, markAsyncJobProcessing, completeAsyncJob } from "../_lib/async-jobs";

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
    ? raw.existingTitles.map((item) => clean(item, 240)).filter(Boolean).slice(0, 50)
    : []);
  return { query, requestedQuery, goal, count, semantics, geography, competitorInsights, brand, existingTitles };
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
    lsi: { type: "array", items: { type: "string" } },
    audience: { type: "string" },
    metaTitle: { type: "string" },
    metaDescription: { type: "string" },
    structure: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    evidenceNeeded: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["id", "title", "subtitle", "cluster", "format", "intent", "stage", "priority", "angle", "objective", "primaryKeyword", "lsi", "audience", "metaTitle", "metaDescription", "structure", "cta", "evidenceNeeded", "sources"],
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

function validatePlan(plan: AiPlan, input: ReturnType<typeof normalizePayload>) {
  if (!Array.isArray(plan.items) || plan.items.length !== input.count) {
    throw new AiResponseError(`AI‑редакция подготовила неполный план. Требуется ${input.count} тем.`, 422);
  }

  const cleaned = plan.items.map((item, index) => ({
    ...item,
    id: `plan-${index + 1}`,
    title: cleanPlanTitle(clean(item.title, 220)),
    subtitle: clean(item.subtitle, 360),
    cluster: clean(item.cluster, 100),
    angle: clean(item.angle, 500),
    objective: clean(item.objective, 500),
    primaryKeyword: clean(item.primaryKeyword, 220),
    lsi: unique((Array.isArray(item.lsi) ? item.lsi : []).map((value) => clean(value, 180))).slice(0, 8),
    audience: clean(item.audience, 700),
    metaTitle: clean(item.metaTitle, 90),
    metaDescription: clean(item.metaDescription, 190),
    structure: unique((Array.isArray(item.structure) ? item.structure : []).map((value) => clean(value, 180))).slice(0, 8),
    cta: clean(item.cta, 300),
    evidenceNeeded: unique((Array.isArray(item.evidenceNeeded) ? item.evidenceNeeded : []).map((value) => clean(value, 220))).slice(0, 8),
    sources: unique((Array.isArray(item.sources) ? item.sources : []).map((value) => clean(value, 80))).slice(0, 8),
  }));

  const normalizedTitles = cleaned.map((item) => titleKey(item.title));
  const duplicates = normalizedTitles.filter((title, index) => title && normalizedTitles.indexOf(title) !== index);
  const existingTitleKeys = new Set(input.existingTitles.map(titleKey).filter(Boolean));
  const repeatsExisting = cleaned.filter((item) => existingTitleKeys.has(titleKey(item.title)));
  const allowedFormats = GOAL_FORMAT_LOCK[input.goal];
  const invalid = cleaned.filter((item) => (
    !item.title || !item.cluster || !item.primaryKeyword || !item.angle || !item.objective
    || item.lsi.length < 2 || item.structure.length < 3
    || !allowedFormats.includes(item.format)
    || /(?:комментарий пользователя|редакционн(?:ая|ый) задач|используй|добавь|раскрой применительно|инструкц(?:ия|ии) для ии)/i.test(item.title)
  ));

  if (duplicates.length || repeatsExisting.length || invalid.length) {
    throw new AiResponseError("AI‑редакция подготовила слабый или повторяющийся контент‑план. Запустите анализ ещё раз.", 422);
  }
  return cleaned;
}

// The actual AI call + validation + quota debit, extracted out of the
// route handler so it can run after the response has already gone back
// to the client (see async-jobs.ts for why that's safe on this host).
// Everything here is unchanged from the old synchronous handler — only
// where it's called from moved.
async function runContentPlanGeneration(input: ReturnType<typeof normalizePayload>, ownerEmail: string) {
  const instructions = [
      "Ты — ведущий контент‑стратег и SEO‑редактор платформы КЛИО.",
      ...CORE_SYSTEM_RULES,
      "Работай как редакционная система бренда, а не генератор общих заголовков. Сначала используй весь доступный профиль: предложение, аудиторию, позиционирование, подтверждённые преимущества, доказательства, географию, голос и ограничения.",
      input.requestedQuery ? "Основная тема пользователя задаёт фокус плана; не выходи за неё без явной связи с брендом." : "Отдельная тема и семантика не заданы: построй разнообразный общий контент‑план вокруг отрасли и задач аудитории, а не каталог бренда. Расширяй поле от услуг бренда к близким проблемам, критериям выбора, подготовке, использованию, уходу, типичным ошибкам, смежным решениям и экспертным вопросам, которые могут привести новую аудиторию. Не сужай план до одного преимущества или одной услуги.",
      // Универсальное правило для любого бренда и отрасли: тема/фокус часто
      // называет категорию, а не одну конкретную тему ("акцент на
      // программах лечения", "по каждой услуге", "линейка продуктов",
      // "виды процедур") — без этого правила модель просто держала
      // категорию в уме как общий вектор и выдавала разноплановые темы
      // вокруг неё, а не по одной теме на каждый пункт категории, чего
      // ожидал пользователь.
      "Если тема или фокус называет категорию из нескольких пунктов без явного перечисления самих пунктов (например: «акцент на программах лечения», «по каждой услуге», «наши направления», «линейка продуктов», «виды процедур»), сначала определи конкретные пункты этой категории — в первую очередь по продуктам и услугам из профиля бренда, если они там названы; если в профиле их нет, опирайся на типичные пункты такой категории в этой отрасли, не приписывая бренду недостоверные детали. Затем построй план так, чтобы каждый пункт (или большинство пунктов, если их больше, чем тем в плане) получил отдельную тему со своим углом и практической пользой, а не растворялся в одном общем обзоре.",
      `Создай ровно ${input.count} готовых к работе тем для единой контент‑системы, а не перечень шаблонных заголовков.`,
      GOAL_INSTRUCTION[input.goal],
      "Сначала определи предмет, аудиторию, поисковые интенты, коммерческую задачу и возможные тематические ветви. Не переносить знания или шаблоны из другой отрасли.",
      "Разведи ядро, широкие обзоры, средние подтемы, узкие long-tail вопросы и действительно смежные темы. Смежная тема должна поддерживать решение аудитории или экспертизу бренда, а не быть случайной ассоциацией.",
      input.semantics.length
        ? "Семантика — это карта реального спроса для серии публикаций, а не набор ключей одной статьи. Построй план по её кластерам: одна строка плана использует один кластер и один поисковый интент; основной запрос и все поддерживающие формулировки строки должны относиться к этому же кластеру. Не смешивай кластеры в одном материале. Один кластер можно развить несколькими материалами только для явно разных вопросов или интентов, без каннибализации."
        : "Семантика не передана: построй план по теме и профилю, но не выдумывай частотность запросов.",
      input.semantics.length
        ? "В первую очередь используй небрендовые, широкие и смежные кластеры, чтобы приводить новую аудиторию. Брендовые, навигационные и запросы вида «официальный сайт», «цены» оставляй для отдельных конверсионных страниц или материалов только когда это прямо соответствует цели плана; не подменяй ими статьи для роста новой аудитории. Частотность — сигнал приоритета среди сопоставимых кластеров, но не единственный критерий: учитывай интент, полезность и соответствие бренду."
        : "Без семантики проведи веб‑исследование тематического поля и предложи околоотраслевые, околотематические и полезные для новой аудитории направления. Не выдумывай частотность и не делай все темы брендовыми. Уместные календарные поводы и праздники можно включать только если они действительно связаны с предложением, аудиторией или сезонным спросом бренда и дают читателю самостоятельную пользу. Не добавляй формальные поздравления, случайные даты и выдуманную сезонность.",
      "Сбалансируй воронку: знакомство, выбор, решение и удержание. Не делай весь план информационными инструкциями и не превращай коммерческие темы в статьи «как выбрать». Для темы с конкретным брендом или продуктом предусмотрены материалы о его предложении, доказательствах, сценариях применения и возражениях.",
      "Если тема или фокус не указывает на конкретную категорию для разбора по пунктам (см. правило выше), не строй план вокруг одного преимущества и не превращай его в скучный каталог услуг без содержания. Разделяй образовательные, коммерческие, репутационные и вовлекающие задачи; не выдумывай сезонность, статистику, тренды или кейсы.",
      "Каждый title — чистый публикационный заголовок без номера, комментария, редакционной команды, пояснения в скобках и фраз вроде «использовать выводы». Не добавляй одинаковые каркасы «полный разбор», «основные ошибки», «пошаговый маршрут» ко всем темам.",
      input.existingTitles.length ? `Это уже созданные темы и материалы бренда. Не повторяй их, не делай близкие перефразировки и не возвращай ту же задачу с переставленными словами: ${input.existingTitles.map((title) => `«${title}»`).join("; ")}` : "Если ранее созданные темы не переданы, всё равно не повторяй идеи внутри текущего плана.",
      "Каждая строка должна иметь собственный ракурс, коммуникационную цель, целевую аудиторию, основной запрос, 2–8 поддерживающих формулировок и предметную структуру из 3–8 разделов.",
      "Поле lsi означает поддерживающие формулировки, сущности и вопросы. Не называй их LSI‑факторами и не имитируй частотность.",
      "Title, subtitle и Description должны точно соответствовать теме. subtitle — зацепка под H1: 1–2 предложения с пользой читателю, не повторяет title. Не обещай позиции, результат лечения, доход, сроки, цены и иные факты, которых нет в источниках.",
      "В evidenceNeeded перечисли, какие факты, документы, цифры, кейсы или экспертные комментарии нужны редактору. В sources укажи только реально переданные слои: Тема, Семантика, География, Матрица, Профиль бренда.",
      "Для каждой строки сначала сформируй скрытый editorialBrief: вопрос читателя, интент, сегмент аудитории, ракурс, ключевое сообщение, формат, тон, авторскую позицию, структуру, ключевые пункты, ключи, известные факты, неизвестные данные, возражения, CTA и ограничения. Во внешний JSON выводи только поля текущей схемы; не раскрывай editorialBrief в title или описании.",
      // Used to also tell the model to web-search for real query phrasing
      // and cap itself to 1-2 rounds — removed along with useWebSearch
      // itself (see the fix history in ai-config.ts's generate_content_plan
      // entry): the model kept ignoring the round cap (10 search rounds
      // observed in one failed run) and the ban on narrating progress
      // between them, so the instruction was pure noise once the tool
      // it referred to was taken away too.
      "Опирайся на переданный профиль бренда, семантику и географию — не выдумывай факты, частотность или подробности, которых там нет.",
      "Не пиши промежуточные текстовые сообщения о ходе работы («приступаю к анализу», «теперь перейду к плану» и т.п.). Единственный текстовый ответ — финальный JSON с готовым планом.",
      "Верни только структурированный результат по заданной JSON‑схеме.",
      ...FINAL_QA_RULES,
    ].join("\n");

  const { result: aiPlan, model } = await callAiModel<AiPlan>({
    operation: "generate_content_plan",
    ownerEmail,
    schemaName: "klio_content_plan",
    schema: contentPlanSchema(input.count),
    instructions,
    input: JSON.stringify({
      main_topic: input.query,
      plan_basis: input.requestedQuery ? "user_topic" : "brand_profile",
      plan_goal: input.goal,
      allowed_formats: GOAL_FORMAT_LOCK[input.goal],
      selected_semantics: input.semantics,
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
      competitor_editorial_opportunities: input.competitorInsights,
      brand_profile: input.brand.name ? input.brand : null,
      existing_titles_to_exclude: input.existingTitles,
      editorial_brief_contract: {
        topic: "title", subtitle: "subtitle", intent: "intent", objective: "objective", audience: "audience", angle: "angle", format: "format",
        structure: "structure", keywords: ["primaryKeyword", "lsi"], evidenceNeeded: "evidenceNeeded", sources: "sources",
        knownFacts: input.brand.name ? [input.brand.description, input.brand.positioning, input.brand.advantages, input.brand.products, input.brand.services, input.brand.proof].filter(Boolean) : [],
        restrictions: [input.brand.restrictions, input.brand.prohibited].filter(Boolean),
        authorPosition: "brand for commercial brand materials; neutral or expert otherwise",
      },
      required_items: input.count,
    }, null, 2),
  });

  const items = validatePlan(aiPlan, input);
  const usage = await recordResearch();
  return {
    mode: "ai" as const,
    model,
    usage,
    result: {
      query: input.query,
      items,
      clusters: unique(items.map((item) => item.cluster)),
      dataNote: input.semantics.length
        ? "План построен по карте подтверждённого спроса: каждая тема привязана к одному кластеру и отдельной задаче читателя. В приоритете — небрендовые и смежные запросы для привлечения новой аудитории; брендовый спрос вынесен в отдельную конверсионную ветку."
        : "План создан AI‑стратегом по текущей теме и подключённым источникам. Подключите семантику, чтобы приоритизировать темы по подтверждённому спросу.",
    },
  };
}

// Runs the generation in the background and writes the outcome to the job
// row — never thrown/awaited by the route handler that kicks it off.
async function runContentPlanJob(jobId: string, input: ReturnType<typeof normalizePayload>, ownerEmail: string) {
  try {
    await markAsyncJobProcessing(jobId);
    const payload = await runContentPlanGeneration(input, ownerEmail);
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
    const raw = await request.json() as ContentPlanPayload;
    const input = normalizePayload(raw);
    if (!input.query) return Response.json({ error: "Укажите тему или заполните название и основу профиля бренда." }, { status: 400 });
    // Checked up front, synchronously, so an account that's already over
    // its limit gets a clean 429 immediately instead of a job that's
    // created only to fail a few seconds later.
    await assertSecondaryQuotaAvailable("research");
    const identity = await workspaceIdentity();
    const jobId = await createAsyncJob("content_plan", identity.email, input);
    // Intentionally not awaited — see async-jobs.ts for why this keeps
    // running after the response below is sent on this host.
    void runContentPlanJob(jobId, input, identity.email);
    return Response.json({ jobId });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось запустить сборку контент‑плана.");
  }
}
