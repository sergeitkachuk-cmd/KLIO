import { assertGenerationQuotaAvailable, recordGeneration, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";

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

function outputText(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const source = response as { output_text?: unknown; output?: unknown };
  if (typeof source.output_text === "string") return source.output_text;
  if (!Array.isArray(source.output)) return "";
  for (const item of source.output) {
    if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
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

    const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 12000,
        tools: [{ type: "web_search", search_context_size: "medium" }],
        text: {
          verbosity: "medium",
          format: { type: "json_schema", name: "klio_quick_material", strict: true, schema: QUICK_MATERIAL_SCHEMA },
        },
        instructions: [
          "Ты — старший русскоязычный редактор и контент‑маркетолог платформы КЛИО.",
          "Пользователь описал задачу свободным текстом в одном окне — как в чате с ассистентом, без отдельных полей темы, формата и ключей. Разберись сам, не задавай уточняющих вопросов.",
          "Определи формат публикации по смыслу задачи: seo — SEO‑статья, social — пост для соцсетей, ads — рекламный текст, landing — текст для сайта. Если формат не назван явно, выбери самый подходящий и укажи его в поле format (ровно одно из этих четырёх значений).",
          "Определи подходящую интонацию по смыслу задачи и бренду (например: Экспертный, Дружелюбный, Разговорный, Молодёжный, Понятный, Вовлекающий) и укажи её в поле tone одним словом или коротким сочетанием.",
          "Если в задаче назван конкретный бренд, компания, продукт или сайт, выполни веб‑поиск, найди официальный сайт и реальные факты о нём. Не выдумывай функции, преимущества, характеристики или программу — пиши только на подтверждённых фактах. Если поиск не подтвердил, что это за компания или продукт, честно опирайся только на то, что подтвердилось, и отметь пробел в editorial_comment.",
          "Любой факт из веб‑поиска обязательно отметь в editorial_comment вместе со ссылкой на источник и пометкой «найдено в вебе, требует проверки».",
          "Если объём не указан явно, выбери разумный объём под формат: SEO‑статья — 700–1200 слов, пост для соцсетей — 80–200 слов, реклама — 60–120 слов, текст для сайта — 300–600 слов.",
          "Материал должен быть готов к публикации сразу: конкретный, без воды, без пересказа задачи и без служебных пометок внутри текста.",
          "Для медицинской, юридической и финансовой тематики избегай гарантий результата, диагнозов и персональных рекомендаций.",
          "Структура JSON: title, body, meta_title, meta_description, editorial_comment, format, tone. Все значения — строки.",
        ].join("\n"),
        input: `Задача пользователя (свободный текст, разбери сам): ${prompt}`,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Quick generation failed", aiResponse.status, errorText.slice(0, 1200));
      return Response.json({ error: "AI‑редакция временно не ответила. Попробуйте ещё раз." }, { status: 502 });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(outputText(await aiResponse.json()));
    } catch {
      return Response.json({ error: "Не удалось разобрать ответ ИИ. Попробуйте переформулировать задачу." }, { status: 502 });
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

    const format = typeof parsed.format === "string" && ALLOWED_FORMATS.has(parsed.format) ? parsed.format : "seo";
    const tone = typeof parsed.tone === "string" && parsed.tone.trim() ? parsed.tone.trim().slice(0, 60) : "Понятный";
    const targetLength = material.body.trim().split(/\s+/).filter(Boolean).length;

    const usage = await recordGeneration({
      brandId: typeof payload.brandId === "string" ? payload.brandId : undefined,
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

    return Response.json({ material, mode: "ai", model, format, tone, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Quick generation route failed", error);
    return Response.json({ error: "Не удалось сформировать материал. Попробуйте ещё раз." }, { status: 500 });
  }
}
