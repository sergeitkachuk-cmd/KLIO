import { AiResponseError, openAiErrorResponse, requestStructuredJson } from "../../_lib/openai-response";
import { assertSecondaryQuotaAvailable, recordEditorialAction, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";

type ReplacementPayload = {
  query?: unknown;
  selectedItems?: unknown;
  existingTitles?: unknown;
  preference?: unknown;
  comment?: unknown;
  brand?: unknown;
};

type PlanAlternative = {
  title: string;
  cluster: string;
  format: "SEO‑статья" | "Экспертный разбор" | "FAQ" | "Сравнение" | "Кейс" | "Посадочная страница" | "Пост";
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

type ReplacementGroup = {
  sourceId: string;
  alternatives: PlanAlternative[];
};

type ReplacementResult = {
  replacements: ReplacementGroup[];
};

const FORMATS = ["SEO‑статья", "Экспертный разбор", "FAQ", "Сравнение", "Кейс", "Посадочная страница", "Пост"] as const;
const INTENTS = ["Информационный", "Коммерческий", "Транзакционный", "Смешанный", "Навигационный"] as const;
const STAGES = ["Знакомство", "Выбор", "Решение", "Удержание"] as const;
const PRIORITIES = ["Высокий", "Средний", "Дополнительный"] as const;

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanList(value: unknown, limit: number, maxLength: number) {
  return Array.isArray(value) ? value.map((item) => clean(item, maxLength)).filter(Boolean).slice(0, limit) : [];
}

function normalizePayload(raw: ReplacementPayload) {
  const selectedItems = Array.isArray(raw.selectedItems) ? raw.selectedItems.slice(0, 5).map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: clean(source.id, 100),
      title: clean(source.title, 240),
      cluster: clean(source.cluster, 120),
      format: clean(source.format, 80),
      intent: clean(source.intent, 80),
      stage: clean(source.stage, 80),
      angle: clean(source.angle, 600),
      objective: clean(source.objective, 600),
      primaryKeyword: clean(source.primaryKeyword, 220),
    };
  }).filter((item) => item.id && item.title) : [];
  const brandSource = raw.brand && typeof raw.brand === "object" ? raw.brand as Record<string, unknown> : {};
  return {
    query: clean(raw.query, 300),
    selectedItems,
    existingTitles: cleanList(raw.existingTitles, 30, 240),
    preference: clean(raw.preference, 120),
    comment: clean(raw.comment, 1200),
    brand: {
      name: clean(brandSource.name, 160),
      description: clean(brandSource.description, 1800),
      positioning: clean(brandSource.positioning, 1200),
      audience: clean(brandSource.audience, 1200),
      advantages: clean(brandSource.advantages, 1800),
    },
  };
}

const alternativeSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    cluster: { type: "string" },
    format: { type: "string", enum: FORMATS },
    intent: { type: "string", enum: INTENTS },
    stage: { type: "string", enum: STAGES },
    priority: { type: "string", enum: PRIORITIES },
    angle: { type: "string" },
    objective: { type: "string" },
    primaryKeyword: { type: "string" },
    lsi: { type: "array", minItems: 2, maxItems: 8, items: { type: "string" } },
    audience: { type: "string" },
    metaTitle: { type: "string" },
    metaDescription: { type: "string" },
    structure: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
    cta: { type: "string" },
    evidenceNeeded: { type: "array", maxItems: 8, items: { type: "string" } },
    sources: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
  },
  required: ["title", "cluster", "format", "intent", "stage", "priority", "angle", "objective", "primaryKeyword", "lsi", "audience", "metaTitle", "metaDescription", "structure", "cta", "evidenceNeeded", "sources"],
  additionalProperties: false,
} as const;

function replacementSchema(selectedIds: string[]) {
  return {
    type: "object",
    properties: {
      replacements: {
        type: "array",
        minItems: selectedIds.length,
        maxItems: selectedIds.length,
        items: {
          type: "object",
          properties: {
            sourceId: { type: "string", enum: selectedIds },
            alternatives: { type: "array", minItems: 2, maxItems: 3, items: alternativeSchema },
          },
          required: ["sourceId", "alternatives"],
          additionalProperties: false,
        },
      },
    },
    required: ["replacements"],
    additionalProperties: false,
  } as const;
}

function normalizeAlternative(item: PlanAlternative) {
  return {
    ...item,
    title: clean(item.title, 220),
    cluster: clean(item.cluster, 100),
    angle: clean(item.angle, 500),
    objective: clean(item.objective, 500),
    primaryKeyword: clean(item.primaryKeyword, 220),
    lsi: cleanList(item.lsi, 8, 180),
    audience: clean(item.audience, 700),
    metaTitle: clean(item.metaTitle, 90),
    metaDescription: clean(item.metaDescription, 190),
    structure: cleanList(item.structure, 8, 180),
    cta: clean(item.cta, 300),
    evidenceNeeded: cleanList(item.evidenceNeeded, 8, 220),
    sources: cleanList(item.sources, 8, 80),
  };
}

export async function POST(request: Request) {
  try {
    const input = normalizePayload(await request.json() as ReplacementPayload);
    if (!input.query) return Response.json({ error: "Укажите тему контент‑плана." }, { status: 400 });
    if (!input.selectedItems.length) return Response.json({ error: "Выберите от одной до пяти тем для замены." }, { status: 400 });
    await assertSecondaryQuotaAvailable("editor");

    const instructions = [
      "Ты — выпускающий контент‑стратег платформы КЛИО.",
      "Для каждой выбранной темы предложи ровно три самостоятельные альтернативы. Остальной контент‑план не меняется.",
      "Альтернативы должны сохранять общую стратегию плана, но не повторять исходный заголовок, другие темы плана и друг друга.",
      "Учитывай пожелание пользователя. Если выбрана смена ракурса — меняй смысловой угол; если продающий вариант — усиливай коммерческую задачу без давления; если новый формат — действительно меняй формат публикации.",
      "Каждая альтернатива должна быть полностью готовой строкой плана: заголовок, ракурс, цель, основной запрос, семантика, аудитория, SEO‑поля, структура, CTA и фактура.",
      "Не придумывай цены, показатели, гарантии, медицинские обещания и иные неподтверждённые факты.",
      "Верни только структурированный JSON по схеме.",
    ].join("\n");

    const { result, model } = await requestStructuredJson<ReplacementResult>({
      schemaName: "klio_content_plan_replacements",
      schema: replacementSchema(input.selectedItems.map((item) => item.id)),
      instructions,
      input: JSON.stringify({
        plan_topic: input.query,
        selected_topics: input.selectedItems,
        excluded_titles: input.existingTitles,
        replacement_preference: input.preference || "Предложить другой сильный ракурс",
        user_comment: input.comment || null,
        brand_profile: input.brand.name ? input.brand : null,
      }, null, 2),
      reasoningEffort: "low",
      verbosity: "medium",
      maxOutputTokens: 12000,
    });

    const existing = new Set(input.existingTitles.map((item) => item.toLocaleLowerCase("ru-RU")));
    const seenGroups = new Set<string>();
    const replacements = result.replacements.map((group) => ({
      sourceId: group.sourceId,
      alternatives: group.alternatives.map(normalizeAlternative),
    }));
    for (const group of replacements) {
      if (!input.selectedItems.some((item) => item.id === group.sourceId) || seenGroups.has(group.sourceId) || group.alternatives.length < 2) {
        throw new AiResponseError("AI‑стратег вернул неполный набор альтернатив. Повторите замену.", 422);
      }
      seenGroups.add(group.sourceId);
      const local = new Set<string>();
      for (const alternative of group.alternatives) {
        const key = alternative.title.toLocaleLowerCase("ru-RU");
        if (!alternative.title || !alternative.primaryKeyword || alternative.lsi.length < 2 || alternative.structure.length < 3 || existing.has(key) || local.has(key)) {
          throw new AiResponseError("AI‑стратег предложил повторяющиеся или неполные темы. Повторите замену.", 422);
        }
        local.add(key);
      }
    }
    if (seenGroups.size !== input.selectedItems.length) throw new AiResponseError("Не для всех выбранных тем подготовлены альтернативы.", 422);

    const usage = await recordEditorialAction();
    return Response.json({ mode: "ai", model, replacements, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось подобрать альтернативы. Уточните пожелание и повторите попытку.");
  }
}
