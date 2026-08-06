import { assertGenerationQuotaAvailable, recordGeneration, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { AiCallError, callAiModel } from "../../_lib/ai-router";

type QuickPayload = { prompt?: unknown; brandId?: unknown };

const ALLOWED_FORMATS = new Set(["seo", "social", "ads", "landing"]);

// Same shape as generate/route.ts's MATERIAL_SCHEMA, plus format/tone so the
// UI can reflect what KLIO inferred from the freeform prompt.
const QUICK_MATERIAL_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    editorial_comment: { type: "string" },
    format: { type: "string", enum: ["seo", "social", "ads", "landing"] },
    tone: { type: "string" },
  },
  required: ["title", "body", "meta_title", "meta_description", "editorial_comment", "format", "tone"],
  additionalProperties: false,
} as const;

// Stage 1 of the pipeline: a cheap, fast nano pass that turns the visitor's
// freeform single-box prompt into a small structured brief (format, tone,
// topic, target length) before the expensive Luna generation call. This is
// exactly the kind of short, formalized, non-creative classification task
// the utility model is for — see ai-config.ts.
const QUICK_BRIEF_SCHEMA = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["seo", "social", "ads", "landing"] },
    tone: { type: "string" },
    topic: { type: "string" },
    target_length: { type: "integer" },
  },
  required: ["format", "tone", "topic", "target_length"],
  additionalProperties: false,
} as const;

type QuickBrief = {
  format: "seo" | "social" | "ads" | "landing";
  tone: string;
  topic: string;
  targetLength: number;
};

function normalizeBrief(parsed: Record<string, unknown>): QuickBrief {
  const format = typeof parsed.format === "string" && ALLOWED_FORMATS.has(parsed.format)
    ? parsed.format as QuickBrief["format"]
    : "seo";
  const tone = typeof parsed.tone === "string" && parsed.tone.trim() ? parsed.tone.trim().slice(0, 60) : "Понятный";
  const topic = typeof parsed.topic === "string" && parsed.topic.trim() ? parsed.topic.trim().slice(0, 300) : "";
  const rawLength = Number(parsed.target_length);
  const targetLength = Number.isFinite(rawLength) && rawLength >= 30 && rawLength <= 4000 ? Math.round(rawLength) : 800;
  return { format, tone, topic, targetLength };
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as QuickPayload;
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim().slice(0, 4000) : "";
    if (prompt.split(/\s+/).filter(Boolean).length < 4) {
      return Response.json({ error: "Опишите задачу чуть подробнее — тему, бренд или сайт и что нужно написать." }, { status: 400 });
    }

    await assertGenerationQuotaAvailable();

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return Response.json({
        error: "ИИ пока не подключён. Демонстрационные ответы отключены, чтобы КЛИО не подменяла вашу задачу шаблонным текстом.",
        code: "AI_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const identity = await workspaceIdentity();
    const brandId = typeof payload.brandId === "string" ? payload.brandId : undefined;

    let brief: QuickBrief;
    try {
      const briefCall = await callAiModel<Record<string, unknown>>({
        operation: "normalize_quick_brief",
        ownerEmail: identity.email,
        brandId,
        schemaName: "klio_quick_brief",
        schema: QUICK_BRIEF_SCHEMA,
        instructions: [
          "Ты разбираешь свободный текст задачи пользователя платформы КЛИО на структурированный бриф.",
          "Определи формат публикации: seo — SEO‑статья, social — пост для соцсетей, ads — рекламный текст, landing — текст для сайта. Если не назван явно, выбери самый подходящий по смыслу.",
          "Определи подходящую интонацию (например: Экспертный, Дружелюбный, Разговорный, Молодёжный, Понятный, Вовлекающий) одним словом или коротким сочетанием.",
          "Сформулируй краткую конкретную тему материала (topic) по смыслу задачи — не пересказывай задачу дословно, а выдели предмет.",
          "Оцени разумный целевой объём в словах (target_length) под формат: SEO‑статья — 700–1200, пост для соцсетей — 80–200, реклама — 60–120, текст для сайта — 300–600. Если пользователь указал объём явно — используй его.",
          "Верни только валидный JSON со всеми четырьмя полями.",
        ].join("\n"),
        input: `Задача пользователя: ${prompt}`,
      });
      brief = normalizeBrief(briefCall.result);
    } catch (error) {
      if (error instanceof AiCallError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    let parsed: Record<string, unknown>;
    let usedModel = "";
    try {
      const materialCall = await callAiModel<Record<string, unknown>>({
        operation: "generate_quick_material",
        ownerEmail: identity.email,
        brandId,
        schemaName: "klio_quick_material",
        schema: QUICK_MATERIAL_SCHEMA,
        instructions: [
          "Ты — старший русскоязычный редактор и контент‑маркетолог платформы КЛИО.",
          "Пользователь описал задачу свободным текстом в одном окне — как в чате с ассистентом, без отдельных полей темы, формата и ключей.",
          "Разбор задачи уже выполнен (см. inferred_brief): используй его формат, интонацию, тему и целевой объём как основу, но не копируй их в текст статьи и не упоминай сам факт разбора.",
          "Поле format в ответе должно совпадать с inferred_brief.format, поле tone — с inferred_brief.tone, если только сам текст задачи явно не требует иного.",
          "Если в задаче назван конкретный бренд, компания, продукт или сайт, выполни веб‑поиск, найди официальный сайт и реальные факты о нём. Не выдумывай функции, преимущества, характеристики или программу — пиши только на подтверждённых фактах. Если поиск не подтвердил, что это за компания или продукт, честно опирайся только на то, что подтвердилось, и отметь пробел в editorial_comment.",
          "Любой факт из веб‑поиска обязательно отметь в editorial_comment вместе со ссылкой на источник и пометкой «найдено в вебе, требует проверки».",
          "Материал должен быть готов к публикации сразу: конкретный, без воды, без пересказа задачи и без служебных пометок внутри текста.",
          "Для медицинской, юридической и финансовой тематики избегай гарантий результата, диагнозов и персональных рекомендаций.",
          "Структура JSON: title, body, meta_title, meta_description, editorial_comment, format, tone. Все значения — строки.",
        ].join("\n"),
        input: JSON.stringify({
          user_prompt: prompt,
          inferred_brief: { format: brief.format, tone: brief.tone, topic: brief.topic, target_length: brief.targetLength },
        }),
      });
      parsed = materialCall.result;
      usedModel = materialCall.model;
    } catch (error) {
      if (error instanceof AiCallError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const material = {
      title: typeof parsed.title === "string" ? parsed.title : "",
      body: typeof parsed.body === "string" ? parsed.body : "",
      metaTitle: typeof parsed.meta_title === "string" ? parsed.meta_title : "",
      metaDescription: typeof parsed.meta_description === "string" ? parsed.meta_description : "",
      editorialComment: typeof parsed.editorial_comment === "string" ? parsed.editorial_comment : "",
    };
    if (!material.title || !material.body) {
      return Response.json({ error: "ИИ не вернул материал. Попробуйте ещё раз." }, { status: 502 });
    }

    const format = typeof parsed.format === "string" && ALLOWED_FORMATS.has(parsed.format) ? parsed.format : brief.format;
    const tone = typeof parsed.tone === "string" && parsed.tone.trim() ? parsed.tone.trim().slice(0, 60) : brief.tone;
    const targetLength = material.body.trim().split(/\s+/).filter(Boolean).length;

    const usage = await recordGeneration({
      brandId,
      format,
      topic: prompt.slice(0, 300),
      title: material.title,
      body: material.body,
      metaTitle: material.metaTitle,
      metaDescription: material.metaDescription,
      editorialComment: material.editorialComment,
      keywords: "",
      tone,
      targetLength,
    });

    return Response.json({ material, mode: "ai", model: usedModel, format, tone, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Quick generation route failed", error);
    return Response.json({ error: "Не удалось сформировать материал. Попробуйте ещё раз." }, { status: 500 });
  }
}
