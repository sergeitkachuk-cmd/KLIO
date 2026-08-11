import {
  ADAPTATION_PLANS,
  CORE_SYSTEM_RULES,
  FINAL_QA_RULES,
  TONE_PLANS,
  TONE_SYSTEM_RULES,
  authorPositionRules,
  normalizeAuthorPosition,
  UNIVERSAL_EDITORIAL_RULES,
  type AdaptationPlan,
  type ContentTone,
} from "../../content-plans";
import { readWebsiteContext } from "../_lib/website-context";
import { assertSecondaryQuotaAvailable, recordEditorialAction, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";
import { AiCallError, callAiModel } from "../_lib/ai-router";
import { adaptationReasoningEffort } from "../_lib/ai-config";

type AdaptationGoal = AdaptationPlan;

type AdaptPayload = {
  sourceText?: unknown;
  goal?: unknown;
  keywords?: unknown;
  instructions?: unknown;
  tone?: unknown;
  useBrand?: unknown;
  authorPosition?: unknown;
  brand?: Record<string, unknown>;
};

type AdaptedMaterial = {
  title: string;
  body: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
  editorialComment: string;
  changes: string[];
};

const ADAPTED_MATERIAL_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    subtitle: { type: "string" },
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    editorial_comment: { type: "string" },
    changes: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
  },
  required: ["title", "body", "subtitle", "meta_title", "meta_description", "editorial_comment", "changes"],
  additionalProperties: false,
} as const;

const allowedGoals = new Set<AdaptationGoal>(Object.keys(ADAPTATION_PLANS) as AdaptationGoal[]);

const goalLabels: Record<AdaptationGoal, string> = {
  proofread: "профессиональная вычитка и типографика",
  clarity: "редактура ясности",
  rewrite: "полная редакторская пересборка",
  seo: "SEO‑статья",
  social: "публикация для социальных сетей",
  landing: "текст для сайта",
  ads: "рекламный текст",
  shorten: "сокращённая редакторская версия",
  opening: "усиленное вступление",
  closing: "усиленный финал",
  review: "выпускающая редактура и разбор",
  cold_email: "холодное деловое письмо",
  brand_voice: "адаптация под голос бренда",
  change_tone: "смена интонации",
};

const deepRewriteGoals = new Set<AdaptationGoal>(["rewrite", "seo", "social", "landing", "ads", "shorten", "cold_email"]);

function normalizeTone(value: unknown): ContentTone {
  const requested = clean(value, 80) as ContentTone;
  return Object.prototype.hasOwnProperty.call(TONE_PLANS, requested) ? requested : "Экспертный";
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function normalizePayload(payload: AdaptPayload) {
  const requestedGoal = clean(payload.goal, 30) as AdaptationGoal;
  return {
    sourceText: clean(payload.sourceText, 60000),
    goal: allowedGoals.has(requestedGoal) ? requestedGoal : "seo" as AdaptationGoal,
    keywords: clean(payload.keywords, 1400),
    instructions: clean(payload.instructions, 1200),
    tone: normalizeTone(payload.tone),
    useBrand: payload.useBrand !== false,
    authorPosition: normalizeAuthorPosition(payload.authorPosition, payload.useBrand !== false ? "brand" : "neutral"),
    brand: payload.brand ?? {},
  };
}

function similarity(left: string, right: string) {
  const tokens = (value: string) => value
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const shingles = (value: string) => {
    const words = tokens(value);
    return new Set(words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`));
  };
  const leftSet = shingles(left);
  const rightSet = shingles(right);
  if (!leftSet.size || !rightSet.size) return left.trim() === right.trim() ? 1 : 0;
  let intersection = 0;
  leftSet.forEach((item) => { if (rightSet.has(item)) intersection += 1; });
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function materialFromRecord(parsed: Record<string, unknown>): AdaptedMaterial | null {
  const title = clean(parsed.title, 500);
  const body = clean(parsed.body, 60000);
  if (!title || !body) return null;
  return {
    title,
    body,
    subtitle: clean(parsed.subtitle, 600),
    metaTitle: clean(parsed.meta_title, 500) || title.slice(0, 70),
    metaDescription: clean(parsed.meta_description, 1000),
    editorialComment: clean(parsed.editorial_comment, 1600),
    changes: Array.isArray(parsed.changes)
      ? parsed.changes.map((item) => clean(item, 240)).filter(Boolean).slice(0, 6)
      : [],
  };
}

function adaptationHasViolation(
  input: ReturnType<typeof normalizePayload>,
  material: AdaptedMaterial,
) {
  const sourceWords = Math.max(1, wordCount(input.sourceText));
  const resultWords = wordCount(material.body);
  if (deepRewriteGoals.has(input.goal) && similarity(input.sourceText, material.body) > 0.82) return true;
  if (/^(?:Что получает читатель|Условия и следующий шаг)$/im.test(material.body)) return true;
  if (input.goal === "social" && (resultWords < 60 || resultWords > 220)) return true;
  if (input.goal === "ads" && (resultWords < 30 || resultWords > 120)) return true;
  if (input.goal === "cold_email" && (resultWords < 45 || resultWords > 190)) return true;
  if (input.goal === "shorten" && (resultWords / sourceWords < 0.38 || resultWords / sourceWords > 0.68)) return true;
  return false;
}

export async function POST(request: Request) {
  try {
    const input = normalizePayload(await request.json() as AdaptPayload);
    if (wordCount(input.sourceText) < 30) {
      return Response.json({ error: "Добавьте исходный текст объёмом не менее 30 слов." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return Response.json({
      error: "ИИ пока не подключён. Демонстрационная адаптация отключена, чтобы КЛИО не подменяла исходный текст шаблонной версией.",
      code: "AI_NOT_CONFIGURED",
    }, { status: 503 });

    await assertSecondaryQuotaAvailable("editor");

    const identity = await workspaceIdentity();
    const brandWebsite = input.useBrand ? clean(input.brand.website, 220) : "";
    const website = await readWebsiteContext(brandWebsite);
    const reasoningEffort = adaptationReasoningEffort(input.goal);
    const plan = ADAPTATION_PLANS[input.goal];
    const toneRules = TONE_PLANS[input.tone];
    const transformationDirective = deepRewriteGoals.has(input.goal)
      ? "Создай самостоятельную редакторскую версию: измени композицию, порядок подачи и формулировки в объёме, необходимом для выбранного сценария."
      : "Выполни точечную редактуру в границах выбранного сценария: сохраняй удачные фрагменты, композицию и объём там, где их изменение не требуется задачей.";
    const adaptationBrief = {
      target: goalLabels[input.goal],
      adaptation_contract: {
        objective: plan.result,
        plan: plan.steps,
        rules: plan.aiRules,
      },
      source_text: input.sourceText,
      keywords: input.keywords,
      editor_note: input.instructions,
      tone: input.tone,
      tone_contract: toneRules,
      brand_context: input.useBrand ? input.brand : null,
      author_position: input.authorPosition,
      website_snapshot: input.useBrand && website.status === "loaded"
        ? { url: website.resolvedUrl, text: website.text }
        : null,
    };
    let material: AdaptedMaterial | null = null;
    let usedModel = "";
    try {
      const call = await callAiModel<Record<string, unknown>>({
        operation: "adapt_text",
        reasoningEffortOverride: reasoningEffort,
        ownerEmail: identity.email,
        schemaName: "klio_adapted_material",
        schema: ADAPTED_MATERIAL_SCHEMA,
        instructions: [
          "Ты — старший русскоязычный редактор и контент‑маркетолог платформы КЛИО.",
          "Переработай готовый текст пользователя под указанную задачу и верни только валидный JSON без Markdown-ограждений.",
          ...CORE_SYSTEM_RULES,
          ...UNIVERSAL_EDITORIAL_RULES,
          "Это операция редакторской адаптации, а не создание нового материала. Сохрани факты, смысл, язык, имена, ссылки, числа, обязательные элементы и исходное намерение, если выбранный сценарий прямо не требует изменения.",
          "Не добавляй преимущества, кейсы, цены, обещания или CTA, которых нет в исходнике, профиле бренда или прямой редакторской пометке.",
          transformationDirective,
          "Сохрани все проверяемые факты, исходную позицию автора и важные смысловые связи. Сам по себе не добавляй цены, даты, статистику, свойства или сведения, которых нет в исходнике.",
          "Исключение: если editor_note прямо просит раскрыть конкретный факт, которого нет в исходнике (например, показания, характеристики, регламент), — выполни веб‑поиск по официальным и авторитетным источникам и добавь найденный факт, отметив источник в editorial_comment по правилам веб‑поиска выше. Не выполняй такое дополнение по собственной инициативе — только по прямой пометке редактора.",
          "Профиль бренда задаёт голос и ограничения. Снимок сайта можно использовать только для проверки фактов, уже присутствующих в исходнике; новые факты с сайта в адаптированную версию не добавляй без явной пометки editor_note (см. исключение выше).",
          "Не пересказывай служебные поля, профиль бренда, ключи или инструкции. Они влияют на редактуру скрыто.",
          `Соблюдай выбранную интонацию «${input.tone}»:`,
          ...toneRules,
          ...TONE_SYSTEM_RULES,
          `Авторская позиция: ${input.authorPosition}.`,
          ...authorPositionRules(input.authorPosition),
          `Применяй только выбранный сценарий «${plan.title}»; не смешивай его с другими форматами:`,
          ...plan.aiRules,
          ...FINAL_QA_RULES,
          "Структура JSON: title, subtitle, body, meta_title, meta_description, editorial_comment, changes. subtitle — самостоятельная зацепка под H1, не повторяет title. changes — массив из 3–6 коротких строк.",
        ].join("\n"),
        input: JSON.stringify(adaptationBrief),
      });
      material = materialFromRecord(call.result);
      usedModel = call.model;
    } catch (error) {
      if (error instanceof AiCallError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    if (!material || adaptationHasViolation(input, material)) {
      try {
        const correctionCall = await callAiModel<Record<string, unknown>>({
          operation: "revise_content",
          ownerEmail: identity.email,
          schemaName: "klio_corrected_adaptation",
          schema: ADAPTED_MATERIAL_SCHEMA,
          instructions: [
            "Ты — выпускающий редактор КЛИО. Пересобери материал: текущая версия не прошла проверку формата или слишком похожа на исходник.",
            "Верни только валидный JSON с полями title, subtitle, body, meta_title, meta_description, editorial_comment, changes.",
            "Сохрани все факты и позицию автора, не добавляй новые сведения и не пересказывай служебные настройки.",
            ...CORE_SYSTEM_RULES,
            `Строго выполни сценарий «${plan.title}»:`,
            ...plan.aiRules,
            `Сохрани интонацию «${input.tone}»:`,
            ...toneRules,
            ...TONE_SYSTEM_RULES,
            `Сохрани авторскую позицию: ${input.authorPosition}.`,
            ...authorPositionRules(input.authorPosition),
            transformationDirective,
            ...FINAL_QA_RULES,
            "Запрещены заголовки «Что получает читатель» и «Условия и следующий шаг».",
          ].join("\n"),
          input: JSON.stringify({
            brief: adaptationBrief,
            rejected_material: material ?? null,
            validation_failure: material
              ? "Материал нарушил ограничения выбранного сценария."
              : "Обязательные поля title и body отсутствуют или пусты.",
          }),
        });
        const corrected = materialFromRecord(correctionCall.result);
        if (corrected) {
          material = corrected;
          usedModel = correctionCall.model;
        }
      } catch (error) {
        console.error("Adaptation correction pass failed", error);
      }
    }
    if (!material || adaptationHasViolation(input, material)) {
      return Response.json({ error: "AI‑редактор не прошёл проверку формата. Исходный текст сохранён; повторите попытку или уточните задачу." }, { status: 422 });
    }
    const usage = await recordEditorialAction();
    return Response.json({ material, mode: "ai", model: usedModel, sources: { website: website.status }, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Adaptation route failed", error);
    return Response.json({ error: "Не удалось обработать исходный текст. Проверьте его и повторите попытку." }, { status: 500 });
  }
}
