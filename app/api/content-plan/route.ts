import { AiResponseError, openAiErrorResponse } from "../_lib/openai-response";
import { CORE_SYSTEM_RULES, FINAL_QA_RULES } from "../../content-plans";
import { callAiModel } from "../_lib/ai-router";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";

type SemanticInput = {
  phrase: string;
  cluster: string;
  intent: string;
  breadth: string;
  relation: string;
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
};

type ContentPlanGoal = "mixed" | "seo" | "social" | "landing" | "ads";

type PlanItem = {
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

const CONTENT_PLAN_GOALS = new Set<ContentPlanGoal>(["mixed", "seo", "social", "landing", "ads"]);

function normalizePayload(raw: ContentPlanPayload) {
  const query = clean(raw.query, 300);
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
  return { query, goal, count, semantics, geography, competitorInsights, brand };
}

const itemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
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
  required: ["id", "title", "cluster", "format", "intent", "stage", "priority", "angle", "objective", "primaryKeyword", "lsi", "audience", "metaTitle", "metaDescription", "structure", "cta", "evidenceNeeded", "sources"],
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

  const normalizedTitles = cleaned.map((item) => item.title.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").trim());
  const duplicates = normalizedTitles.filter((title, index) => title && normalizedTitles.indexOf(title) !== index);
  const allowedFormats = GOAL_FORMAT_LOCK[input.goal];
  const invalid = cleaned.filter((item) => (
    !item.title || !item.cluster || !item.primaryKeyword || !item.angle || !item.objective
    || item.lsi.length < 2 || item.structure.length < 3
    || !allowedFormats.includes(item.format)
    || /(?:комментарий пользователя|редакционн(?:ая|ый) задач|используй|добавь|раскрой применительно|инструкц(?:ия|ии) для ии)/i.test(item.title)
  ));

  if (duplicates.length || invalid.length) {
    throw new AiResponseError("AI‑редакция подготовила слабый или повторяющийся контент‑план. Запустите анализ ещё раз.", 422);
  }
  return cleaned;
}

export async function POST(request: Request) {
  try {
    const raw = await request.json() as ContentPlanPayload;
    const input = normalizePayload(raw);
    if (!input.query) return Response.json({ error: "Укажите основную тему контент‑плана." }, { status: 400 });
    await assertSecondaryQuotaAvailable("research");
    const identity = await workspaceIdentity();

    const instructions = [
      "Ты — ведущий контент‑стратег и SEO‑редактор платформы КЛИО.",
      ...CORE_SYSTEM_RULES,
      "Работай как редакционная система бренда, а не генератор общих заголовков. Сначала используй весь доступный профиль: предложение, аудиторию, позиционирование, подтверждённые преимущества, доказательства, географию, голос и ограничения.",
      `Создай ровно ${input.count} готовых к работе тем для единой контент‑системы, а не перечень шаблонных заголовков.`,
      GOAL_INSTRUCTION[input.goal],
      "Сначала определи предмет, аудиторию, поисковые интенты, коммерческую задачу и возможные тематические ветви. Не переносить знания или шаблоны из другой отрасли.",
      "Разведи ядро, широкие обзоры, средние подтемы, узкие long-tail вопросы и действительно смежные темы. Смежная тема должна поддерживать решение аудитории или экспертизу бренда, а не быть случайной ассоциацией.",
      "Сбалансируй воронку: знакомство, выбор, решение и удержание. Не делай весь план информационными инструкциями и не превращай коммерческие темы в статьи «как выбрать». Для темы с конкретным брендом или продуктом предусмотрены материалы о его предложении, доказательствах, сценариях применения и возражениях.",
      "Не строй план вокруг одного преимущества и не превращай его в каталог услуг. Разделяй образовательные, коммерческие, репутационные и вовлекающие задачи; не выдумывай сезонность, статистику, тренды или кейсы.",
      "Каждый title — чистый публикационный заголовок без номера, комментария, редакционной команды, пояснения в скобках и фраз вроде «использовать выводы». Не добавляй одинаковые каркасы «полный разбор», «основные ошибки», «пошаговый маршрут» ко всем темам.",
      "Каждая строка должна иметь собственный ракурс, коммуникационную цель, целевую аудиторию, основной запрос, 2–8 поддерживающих формулировок и предметную структуру из 3–8 разделов.",
      "Поле lsi означает поддерживающие формулировки, сущности и вопросы. Не называй их LSI‑факторами и не имитируй частотность.",
      "Title и Description должны точно соответствовать теме. Не обещай позиции, результат лечения, доход, сроки, цены и иные факты, которых нет в источниках.",
      "В evidenceNeeded перечисли, какие факты, документы, цифры, кейсы или экспертные комментарии нужны редактору. В sources укажи только реально переданные слои: Тема, Семантика, География, Матрица, Профиль бренда.",
      "Для каждой строки сначала сформируй скрытый editorialBrief: вопрос читателя, интент, сегмент аудитории, ракурс, ключевое сообщение, формат, тон, авторскую позицию, структуру, ключевые пункты, ключи, известные факты, неизвестные данные, возражения, CTA и ограничения. Во внешний JSON выводи только поля текущей схемы; не раскрывай editorialBrief в title или описании.",
      "Используй веб-поиск, чтобы опираться на реальные формулировки запросов и подтемы этой ниши, а не только на входной запрос и его парафразы.",
      "Верни только структурированный результат по заданной JSON‑схеме.",
      ...FINAL_QA_RULES,
    ].join("\n");

    const { result: aiPlan, model } = await callAiModel<AiPlan>({
      operation: "generate_content_plan",
      ownerEmail: identity.email,
      schemaName: "klio_content_plan",
      schema: contentPlanSchema(input.count),
      instructions,
      input: JSON.stringify({
        main_topic: input.query,
        plan_goal: input.goal,
        allowed_formats: GOAL_FORMAT_LOCK[input.goal],
        selected_semantics: input.semantics,
        search_geography: input.geography,
        competitor_editorial_opportunities: input.competitorInsights,
        brand_profile: input.brand.name ? input.brand : null,
        editorial_brief_contract: {
          topic: "title", intent: "intent", objective: "objective", audience: "audience", angle: "angle", format: "format",
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
    return Response.json({
      mode: "ai",
      model,
      usage,
      result: {
        query: input.query,
        items,
        clusters: unique(items.map((item) => item.cluster)),
        dataNote: "План создан AI‑стратегом по текущей теме и подключённым источникам. Ширина запросов описывает охват формулировки, а не выдуманную частотность; реальные показы, сезонность и позиции требуют отдельного поискового источника.",
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось собрать контент‑план. Проверьте исходные данные и повторите попытку.");
  }
}
