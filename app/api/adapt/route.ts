import {
  ADAPTATION_PLANS,
  CORE_SYSTEM_RULES,
  FINAL_QA_RULES,
  TONE_PLANS,
  TONE_SYSTEM_RULES,
  authorPositionRules,
  normalizeAuthorPosition,
  ADAPTATION_CORE_RULES,
  type AdaptationPlan,
  type ContentTone,
} from "../../content-plans";
import { readWebsiteContext } from "../_lib/website-context";
import { researchContentPlanWeb } from "../_lib/tavily";
import { assertSecondaryQuotaAvailable, recordEditorialAction, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";
import { AiCallError, callAiModel } from "../_lib/ai-router";
import { adaptationReasoningEffort, aiConfigured } from "../_lib/ai-config";
import { isAiRateLimited } from "../_lib/rate-limit";

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
  deepen: "содержательное углубление темы",
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

const deepRewriteGoals = new Set<AdaptationGoal>(["deepen", "rewrite", "seo", "social", "landing", "ads", "shorten", "cold_email"]);

function coreRulesFor(goal: AdaptationGoal) {
  if (goal !== "deepen") return ADAPTATION_CORE_RULES;
  // Other editors must preserve the source as their complete fact base.
  // "Глубина" is deliberately different: it receives a single bounded
  // server-side research digest and may use only that extra fact base.
  return ADAPTATION_CORE_RULES.filter((rule) => !rule.startsWith("Используй только сведения") && !rule.startsWith("Не дополняй исходник фактами"));
}

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

function adaptationViolationReason(
  input: ReturnType<typeof normalizePayload>,
  material: AdaptedMaterial,
) {
  const sourceWords = Math.max(1, wordCount(input.sourceText));
  const resultWords = wordCount(material.body);
  if (deepRewriteGoals.has(input.goal) && similarity(input.sourceText, material.body) > 0.82) return "Версия слишком похожа на исходник для выбранного сценария.";
  if (/^(?:Что получает читатель|Условия и следующий шаг)$/im.test(material.body)) return "В тексте появился служебный шаблонный заголовок.";
  if (input.goal === "social" && (resultWords < 60 || resultWords > 220)) return "Длина публикации для социальных сетей должна быть от 60 до 220 слов.";
  if (input.goal === "ads" && (resultWords < 30 || resultWords > 120)) return "Длина рекламного текста должна быть от 30 до 120 слов.";
  if (input.goal === "cold_email" && (resultWords < 45 || resultWords > 190)) return "Длина холодного письма должна быть от 45 до 190 слов.";
  if (input.goal === "shorten" && (resultWords / sourceWords < 0.45 || resultWords / sourceWords > 0.6)) {
    return `Режим «Коротко» требует 45–60% от исходника: ${sourceWords} слов в исходнике, нужно от ${Math.ceil(sourceWords * 0.45)} до ${Math.floor(sourceWords * 0.6)} слов в результате, сейчас ${resultWords}.`;
  }
  return null;
}

function adaptationHasViolation(input: ReturnType<typeof normalizePayload>, material: AdaptedMaterial) {
  return Boolean(adaptationViolationReason(input, material));
}

export async function POST(request: Request) {
  try {
    if (isAiRateLimited(request, "adapt", 4)) return Response.json({ error: "Слишком много редакторских запусков подряд. Подождите минуту и повторите." }, { status: 429 });
    const input = normalizePayload(await request.json() as AdaptPayload);
    if (wordCount(input.sourceText) < 30) {
      return Response.json({ error: "Добавьте исходный текст объёмом не менее 30 слов." }, { status: 400 });
    }

    if (!aiConfigured()) return Response.json({
      error: "ИИ пока не подключён. Демонстрационная адаптация отключена, чтобы КЛИО не подменяла исходный текст шаблонной версией.",
      code: "AI_NOT_CONFIGURED",
    }, { status: 503 });

    await assertSecondaryQuotaAvailable("editor");

    const identity = await workspaceIdentity();
    const brandWebsite = input.useBrand ? clean(input.brand.website, 220) : "";
    const researchTopic = input.keywords || input.instructions || input.sourceText.slice(0, 420);
    const [website, webResearch] = await Promise.all([
      readWebsiteContext(brandWebsite),
      input.goal === "deepen" ? researchContentPlanWeb(researchTopic, []) : Promise.resolve(null),
    ]);
    const reasoningEffort = adaptationReasoningEffort(input.goal);
    const plan = ADAPTATION_PLANS[input.goal];
    const toneRules = TONE_PLANS[input.tone];
    const transformationDirective = deepRewriteGoals.has(input.goal)
      ? "Создай самостоятельную редакторскую версию: измени композицию, порядок подачи и формулировки в объёме, необходимом для выбранного сценария."
      : "Выполни точечную редактуру в границах выбранного сценария: сохраняй удачные фрагменты, композицию и объём там, где их изменение не требуется задачей.";
    const shortenLengthDirective = input.goal === "shorten"
      ? `В режиме «Коротко» длина поля body обязательна: от ${Math.ceil(wordCount(input.sourceText) * 0.45)} до ${Math.floor(wordCount(input.sourceText) * 0.6)} слов (45–60% от ${wordCount(input.sourceText)} слов исходника). Проверь число слов перед ответом.`
      : "";
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
      web_research: input.goal === "deepen" && webResearch
        ? webResearch.results.slice(0, 3).map(({ title, url, content }) => ({ title, url, fact: content }))
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
          ...coreRulesFor(input.goal),
          transformationDirective,
          shortenLengthDirective,
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
            ...CORE_SYSTEM_RULES,
            ...coreRulesFor(input.goal),
            `Строго выполни сценарий «${plan.title}»:`,
            ...plan.aiRules,
            `Сохрани интонацию «${input.tone}»:`,
            ...toneRules,
            ...TONE_SYSTEM_RULES,
            `Сохрани авторскую позицию: ${input.authorPosition}.`,
            ...authorPositionRules(input.authorPosition),
            transformationDirective,
            shortenLengthDirective,
            ...FINAL_QA_RULES,
            "Запрещены заголовки «Что получает читатель» и «Условия и следующий шаг».",
          ].join("\n"),
          input: JSON.stringify({
            brief: adaptationBrief,
            rejected_material: material ?? null,
            validation_failure: material
              ? adaptationViolationReason(input, material) ?? "Материал нарушил ограничения выбранного сценария."
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
    return Response.json({ material, mode: "ai", model: usedModel, sources: { website: website.status, webResearch: input.goal === "deepen" ? webResearch?.results.length ?? 0 : 0 }, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Adaptation route failed", error);
    return Response.json({ error: "Не удалось обработать исходный текст. Проверьте его и повторите попытку." }, { status: 500 });
  }
}
