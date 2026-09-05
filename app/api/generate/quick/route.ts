import { assertGenerationQuotaAvailable, recordGeneration, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { AiCallError, callAiModel } from "../../_lib/ai-router";
import { aiConfigured } from "../../_lib/ai-config";
import { publicationCharacters, bodyBudget, trimOverflowBody } from "../../_lib/text-length";

type QuickPayload = { prompt?: unknown; brandId?: unknown; brand?: unknown; lengthHint?: unknown };

type QuickBrandInput = {
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
};

function cleanQuickField(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function plainPublicationText(value: unknown, maxLength: number) {
  return cleanQuickField(value, maxLength)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(?:https?:\/\/|www\.)[^\s<>)\]]+/gi, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gm, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Quick mode previously never received the brand profile at all, even with
// "Использовать бренд" switched on in the workspace — every generation
// came out generic, with no way for a visitor to tell why. Same anti-
// fabrication discipline as the Advanced generator: only pass through what
// the user actually confirmed in their profile, nothing inferred.
function cleanQuickBrand(value: unknown): QuickBrandInput | null {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const brand: QuickBrandInput = {
    name: cleanQuickField(source.name, 160),
    website: cleanQuickField(source.website, 220),
    description: cleanQuickField(source.description, 1800),
    positioning: cleanQuickField(source.positioning, 1400),
    audience: cleanQuickField(source.audience, 1200),
    advantages: cleanQuickField(source.advantages, 2000),
    voice: cleanQuickField(source.voice, 2000),
    restrictions: cleanQuickField(source.restrictions, 2000),
    signature: cleanQuickField(source.signature, 1200),
    prohibited: cleanQuickField(source.prohibited, 2000),
  };
  return brand.name ? brand : null;
}

const ALLOWED_FORMATS = new Set(["seo", "social", "ads", "landing"]);

// Same shape as generate/route.ts's MATERIAL_SCHEMA, plus format/tone so the
// UI can reflect what KLIO inferred from the freeform prompt.
const QUICK_MATERIAL_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    subtitle: { type: "string" },
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    editorial_comment: { type: "string" },
    format: { type: "string", enum: ["seo", "social", "ads", "landing"] },
    tone: { type: "string" },
  },
  required: ["title", "body", "subtitle", "meta_title", "meta_description", "editorial_comment", "format", "tone"],
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
  const targetLength = Number.isFinite(rawLength) && rawLength >= 300 && rawLength <= 30000 ? Math.round(rawLength) : 5600;
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

    if (!aiConfigured()) {
      return Response.json({
        error: "ИИ пока не подключён. Демонстрационные ответы отключены, чтобы КЛИО не подменяла вашу задачу шаблонным текстом.",
        code: "AI_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const identity = await workspaceIdentity();
    const brandId = typeof payload.brandId === "string" ? payload.brandId : undefined;
    // Only present when the workspace's "Использовать бренд" toggle is on
    // (the client omits `brand` entirely otherwise) — Quick mode stays just
    // as usable for one-off topics unrelated to any brand.
    const brand = cleanQuickBrand(payload.brand);
    // Optional explicit override from the "Объём" picker next to the quick
    // prompt. Left undefined ("Автоматически"), KLIO keeps guessing length
    // from the brief below — same as before this control existed.
    const lengthHint = typeof payload.lengthHint === "number" && Number.isFinite(payload.lengthHint)
      && payload.lengthHint >= 300 && payload.lengthHint <= 30000
      ? Math.round(payload.lengthHint)
      : undefined;

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
          "Оцени разумный целевой объём в знаках с пробелами (target_length) под формат: SEO‑статья — 5 000–8 500, пост для соцсетей — 600–1 400, реклама — 400–900, текст для сайта — 2 000–4 500. Если пользователь указал объём явно, воспринимай его как число знаков с пробелами.",
          "Верни только валидный JSON со всеми четырьмя полями.",
        ].join("\n"),
        input: `Задача пользователя: ${prompt}`,
      });
      brief = normalizeBrief(briefCall.result);
      if (lengthHint) brief = { ...brief, targetLength: lengthHint };
    } catch (error) {
      if (error instanceof AiCallError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    // ±15%, matching the Advanced generator's tolerance (see generate/route.ts) —
    // LLMs land "close" to a target reliably, not exact.
    const minimumCharacters = Math.floor(brief.targetLength * 0.85);
    const maximumCharacters = Math.ceil(brief.targetLength * 1.15);

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
          "Разбор задачи уже выполнен (см. inferred_brief): используй его формат, интонацию и тему как основу, но не копируй их в текст статьи и не упоминай сам факт разбора.",
          `Требуемый объём всего материала — title, subtitle и body вместе: ${brief.targetLength} знаков с пробелами. Допустимый диапазон: ${minimumCharacters}–${maximumCharacters}. Это жёсткое требование, а не ориентир — не пиши заметно короче или длиннее диапазона, даже если тема кажется шире или уже.`,
          "Поле format в ответе должно совпадать с inferred_brief.format, поле tone — с inferred_brief.tone, если только сам текст задачи явно не требует иного.",
          ...(brand ? [
            "В brand_profile передан профиль бренда пользователя (кнопка «Использовать бренд» включена) — учитывай его только там, где задача реально про этот бренд. Если задача про другую компанию или тему, не связанную с брендом, profile не подставляй насильно — пиши по задаче.",
            "Когда brand_profile уместен: пиши от лица бренда («мы», «наш/наша/наше»), а не как внешний наблюдатель — запрещены формулы «на сайте компании», «данный бренд предлагает». Используй только то, что подтверждено в description/positioning/audience/advantages — ничего сверх этого не выдумывай. Поля voice/restrictions/prohibited, если заполнены, соблюдай как редакционный стиль и стоп-лист. Если задача требует фактов, которых нет в brand_profile, добавляй только проверяемую отраслевую фактуру отдельно от свойств бренда — не приписывай её бренду.",
            "Поле signature в brand_profile, если заполнено, уместно использовать в конце материала — не обязательно каждый раз, только там, где это естественно по формату.",
          ] : []),
          "Если в задаче назван конкретный бренд, компания, продукт или сайт, выполни веб‑поиск, найди официальный сайт и реальные факты о нём. Не выдумывай функции, преимущества, характеристики или программу — пиши только на подтверждённых фактах. Если поиск не подтвердил, что это за компания или продукт, честно опирайся только на то, что подтвердилось, и отметь пробел в editorial_comment.",
          "Любой факт из веб‑поиска обязательно отметь в editorial_comment вместе со ссылкой на источник и пометкой «найдено в вебе, требует проверки».",
          "Не ограничивайся сайтом бренда. Для экспертного, информационного или маркетингового материала выполни веб‑поиск и по самой теме: добавь проверяемые объяснения, нюансы, критерии выбора, безопасные советы или примеры сценариев, которые делают текст полезным читателю. Общую отраслевую фактуру не выдавай за свойства бренда. Для медицинских, правовых и финансовых тем используй только авторитетные источники, не давай персональных назначений и не обещай результат.",
          "Материал должен быть готов к публикации сразу: конкретный, без воды, без пересказа задачи и без служебных пометок внутри текста.",
          "Пиши обычным чистым текстом для редактора: без Markdown-разметки и символов **, __, ##, >, без маркеров списков. Смысловые акценты делай короткими самостоятельными предложениями.",
          "Список, вопрос или эмодзи используй только при реальной пользе для конкретного формата и интонации — не как украшение. По умолчанию пиши без эмодзи; если формат явно предполагает лёгкий разговорный тон (например, пост для соцсетей), уместен максимум один-два по смыслу, не в каждом абзаце.",
          "Для медицинской, юридической и финансовой тематики избегай гарантий результата, диагнозов и персональных рекомендаций.",
          "Структура JSON: title, subtitle, body, meta_title, meta_description, editorial_comment, format, tone. subtitle — зацепка под заголовком, 1–2 предложения без повтора title. Все значения — строки.",
        ].join("\n"),
        input: JSON.stringify({
          user_prompt: prompt,
          inferred_brief: { format: brief.format, tone: brief.tone, topic: brief.topic, target_length: brief.targetLength },
          brand_profile: brand,
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

    let material = {
      title: plainPublicationText(parsed.title, 500),
      body: plainPublicationText(parsed.body, 60_000),
      subtitle: plainPublicationText(parsed.subtitle, 600),
      metaTitle: plainPublicationText(parsed.meta_title, 500),
      metaDescription: plainPublicationText(parsed.meta_description, 1_000),
      editorialComment: typeof parsed.editorial_comment === "string" ? parsed.editorial_comment : "",
    };
    if (!material.title || !material.body) {
      return Response.json({ error: "ИИ не вернул материал. Попробуйте ещё раз." }, { status: 502 });
    }

    const format = typeof parsed.format === "string" && ALLOWED_FORMATS.has(parsed.format) ? parsed.format : brief.format;
    const tone = typeof parsed.tone === "string" && parsed.tone.trim() ? parsed.tone.trim().slice(0, 60) : brief.tone;

    // Backstop for the case the hard range above still misses: a genuine
    // overshoot delivered straight to the user reads as KLIO ignoring "пост
    // для ТГ" and writing a full article instead. Condense once rather than
    // ship it, mirroring generate/route.ts's condense_overflow pass.
    if (publicationCharacters(material) > maximumCharacters) {
      try {
        const condenseCall = await callAiModel<Record<string, unknown>>({
          operation: "condense_overflow",
          ownerEmail: identity.email,
          brandId,
          schemaName: "klio_quick_material",
          schema: QUICK_MATERIAL_SCHEMA,
          instructions: [
            "Ты сокращаешь уже готовую публикацию до целевого объёма, не переписывая её заново.",
            `Целевой объём всего материала — title, subtitle и body вместе: ${brief.targetLength} знаков с пробелами, допустимо от ${minimumCharacters} до ${maximumCharacters}.`,
            "Сокращай за счёт наименее важного: повторов, избыточных примеров, лишних деталей. Не обрывай мысль или аргумент на середине.",
            "Не добавляй новые факты, не меняй заголовок, тему и формат без необходимости.",
            "Сохрани subtitle, meta_title, meta_description и editorial_comment по смыслу как есть (можно чуть скорректировать под новый объём).",
            "Верни только валидный JSON со всеми полями схемы; format и tone оставь как в исходном материале.",
          ].join("\n"),
          input: JSON.stringify({
            target_characters_with_spaces: brief.targetLength,
            current_material: { ...material, format, tone },
          }),
        });
        const condensed = condenseCall.result;
        const condensedMaterial = {
          title: plainPublicationText(condensed.title, 500) || material.title,
          body: plainPublicationText(condensed.body, 60_000) || material.body,
          subtitle: plainPublicationText(condensed.subtitle, 600) || material.subtitle,
          metaTitle: plainPublicationText(condensed.meta_title, 500) || material.metaTitle,
          metaDescription: plainPublicationText(condensed.meta_description, 1_000) || material.metaDescription,
          editorialComment: typeof condensed.editorial_comment === "string" ? condensed.editorial_comment : material.editorialComment,
        };
        if (condensedMaterial.title && condensedMaterial.body) {
          material = condensedMaterial;
          usedModel = condenseCall.model;
        }
      } catch (error) {
        // Best-effort — ship the original (too-long) material rather than
        // fail a generation the user is already waiting on. The
        // unconditional check right below still catches this case.
        console.error("Quick generation condense pass failed", error);
      }
    }

    // Absolute, non-AI ceiling: covers both the condense call above
    // failing outright and it succeeding but still landing over budget
    // (an LLM asked to shorten text isn't guaranteed to land in range
    // either). A generation can never reach the user over maximumCharacters
    // purely because both AI passes missed the same target.
    if (publicationCharacters(material) > maximumCharacters) {
      material = { ...material, body: trimOverflowBody(material.body, bodyBudget(material, brief.targetLength)) };
    }

    const targetLength = material.body.trim().length;

    const usage = await recordGeneration({
      brandId,
      format,
      topic: prompt.slice(0, 300),
      title: material.title,
      body: material.body,
      subtitle: material.subtitle,
      metaTitle: material.metaTitle,
      metaDescription: material.metaDescription,
      editorialComment: material.editorialComment,
      keywords: "",
      tone,
      targetLength,
    });

    // The client's length/keyword coverage widgets are shared with the
    // Advanced generator and default to whatever was last set there. Quick
    // mode never asks for a target length or keywords, so it must hand
    // back what it actually used (brief.targetLength — the length inferred
    // inferred from the free-text prompt, before generation) so the client
    // can sync its display instead of comparing this result against
    // leftover Advanced-tab state.
    return Response.json({ material, mode: "ai", model: usedModel, format, tone, targetLength: brief.targetLength, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Quick generation route failed", error);
    return Response.json({ error: "Не удалось сформировать материал. Попробуйте ещё раз." }, { status: 500 });
  }
}
