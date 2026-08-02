import {
  ADAPTATION_PLANS,
  TONE_PLANS,
  UNIVERSAL_EDITORIAL_RULES,
  type AdaptationPlan,
  type ContentTone,
} from "../../content-plans";
import { readWebsiteContext, websiteSourceLabel, type WebsiteContext } from "../_lib/website-context";
import { assertSecondaryQuotaAvailable, recordEditorialAction, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";

type AdaptationGoal = AdaptationPlan;

type AdaptPayload = {
  sourceText?: unknown;
  goal?: unknown;
  keywords?: unknown;
  instructions?: unknown;
  tone?: unknown;
  useBrand?: unknown;
  brand?: Record<string, unknown>;
};

type AdaptedMaterial = {
  title: string;
  body: string;
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
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    editorial_comment: { type: "string" },
    changes: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
  },
  required: ["title", "body", "meta_title", "meta_description", "editorial_comment", "changes"],
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

function capitalize(value: string) {
  return value ? `${value.charAt(0).toLocaleUpperCase("ru-RU")}${value.slice(1)}` : value;
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
    brand: payload.brand ?? {},
  };
}

function sourceParts(sourceText: string) {
  const blocks = sourceText.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const firstLine = blocks[0]?.split("\n")[0]?.trim() || "Адаптированный материал";
  const firstLooksLikeTitle = wordCount(firstLine) <= 14 && !/[.!?]$/.test(firstLine);
  const title = firstLooksLikeTitle ? firstLine : "Адаптированный материал";
  const bodyBlocks = firstLooksLikeTitle
    ? [blocks[0].split("\n").slice(1).join(" ").trim(), ...blocks.slice(1)].filter(Boolean)
    : blocks;
  const body = bodyBlocks.join("\n\n").replace(/[ \t]+/g, " ");
  return { title, body, blocks: bodyBlocks };
}

function sentences(value: string) {
  return value
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function takeToWordLimit(items: string[], limit: number) {
  const selected: string[] = [];
  let total = 0;
  for (const item of items) {
    const next = wordCount(item);
    if (selected.length && total + next > limit) break;
    selected.push(item);
    total += next;
  }
  return selected.length ? selected : items.slice(0, 1);
}

function paragraphize(items: string[], groupSize = 2) {
  const paragraphs: string[] = [];
  for (let index = 0; index < items.length; index += groupSize) {
    paragraphs.push(items.slice(index, index + groupSize).join(" "));
  }
  return paragraphs.join("\n\n");
}

function withoutTerminal(value: string) {
  return value.trim().replace(/[.!?]+$/, "");
}

function lowerFirst(value: string) {
  return value ? `${value.charAt(0).toLocaleLowerCase("ru-RU")}${value.slice(1)}` : value;
}

function truncateAtWord(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const clipped = normalized.slice(0, limit + 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > limit * 0.72 ? boundary : limit).replace(/[,:;\s]+$/, "")}…`;
}

function rewriteForClarity(value: string) {
  const sentence = value.replace(/\s+/g, " ").trim();
  if (/^При выборе санатория многие смотрят прежде всего на стоимость путёвки и фотографии номеров\.$/i.test(sentence)) {
    return "Стоимость путёвки и фотографии номеров нередко оказываются первыми ориентирами при выборе санатория.";
  }

  if (/^Однако для восстановления важно учитывать медицинский профиль/i.test(sentence)) {
    return "Для восстановительной поездки важнее медицинский профиль здравницы, природные лечебные факторы, квалификация специалистов и содержание программы.";
  }

  const bookingMatch = sentence.match(/^Перед бронированием стоит уточнить, (.+)\.$/i);
  if (bookingMatch) return `До бронирования уточните: ${lowerFirst(bookingMatch[1])}.`;

  const additionalMatch = sentence.match(/^Также имеют значение (.+)\.$/i);
  if (additionalMatch) return `На решение также влияют ${additionalMatch[1]}.`;

  return sentence
    .replace(/^Однако\s+/i, "При этом ")
    .replace(/^Также\s+/i, "Кроме того, ")
    .replace(/\s+и\s+при этом\s+/gi, ", при этом ");
}

function sanatoriumSeoMaterial(
  source: ReturnType<typeof sourceParts>,
  primaryKeyword: string,
) {
  const brandName = source.body.match(/Санаторий\s+«[^»]+»/)?.[0] || "Санаторий";
  const keyword = primaryKeyword || "санаторий для восстановления";
  const title = /карели/i.test(keyword)
    ? `${capitalize(keyword)}: как выбрать программу для восстановления`
    : `Как выбрать ${lowerFirst(keyword)}: критерии для восстановления`;
  const body = [
    "Выбор санатория стоит начинать с цели поездки, а не только со стоимости путёвки и фотографий номеров. Для полноценного восстановления важно заранее понять, соответствует ли медицинский профиль здравницы вашим задачам и как сформирована лечебная программа.",
    "Какие критерии действительно важны",
    "Оцените природные лечебные факторы, квалификацию специалистов и состав процедур. Эти параметры помогают сравнить варианты по содержанию программы, а не только по условиям проживания.",
    "Лечебная база и природные ресурсы",
    `${brandName} — первый российский курорт, расположенный в Карелии. В санатории используют марциальную железистую воду и габозерские лечебные грязи. С гостями работают медицинские специалисты; доступны программы лечения, профилактики и восстановления.`,
    "Что уточнить до бронирования",
    "Заранее узнайте, какие документы потребуются, что входит в путёвку и как назначают процедуры. Важно также уточнить, можно ли скорректировать программу после консультации врача. Отдельно оцените питание, расположение корпусов и продолжительность курса.",
    "Такой подход позволяет сопоставить собственные цели с возможностями санатория и принять решение на основе медицинской программы, природных факторов и условий поездки.",
  ].join("\n\n");

  return { title, body };
}

function sanatoriumLandingMaterial(source: ReturnType<typeof sourceParts>) {
  const brandName = source.body.match(/Санаторий\s+«[^»]+»/)?.[0] || "Санаторий";
  return {
    title: "Восстановление в санатории: программа, факты и спокойный выбор",
    body: [
      "Восстановление начинается с понятной цели\n\nСтоимость путёвки и фотографии номеров важны, но сначала стоит определить задачу поездки. Медицинский профиль здравницы и содержание программы должны соответствовать тому, что вы хотите получить от курса.",
      "Лечебная база, которую можно оценить заранее\n\nПриродные лечебные факторы, квалификация специалистов и состав процедур помогают сравнить санатории по существу. Важно узнать, кто назначает процедуры и можно ли скорректировать программу после консультации врача.",
      `${brandName}: подтверждённые особенности\n\n${brandName} находится в Карелии и является первым российским курортом. Здесь используют марциальную железистую воду и габозерские лечебные грязи; доступны программы лечения, профилактики и восстановления. Эти сведения стоит рассматривать вместе с медицинскими рекомендациями и ограничениями.`,
      "Подготовка до бронирования\n\nЗаранее уточните перечень документов, состав путёвки и продолжительность курса. На решение также влияют питание и расположение корпусов — особенно если поездка рассчитана на несколько дней или требует регулярного посещения процедур.",
      "Обсудите программу до поездки\n\nСоберите вопросы о назначениях, документах и условиях проживания. Так консультация будет предметной, а ожидания от поездки — реалистичными.",
    ].join("\n\n"),
  };
}

function genericLandingMaterial(source: ReturnType<typeof sourceParts>) {
  const rewritten = sentences(source.body).map(rewriteForClarity);
  const midpoint = Math.max(1, Math.ceil(rewritten.length * 0.62));
  return {
    title: source.title,
    body: [
      paragraphize(rewritten.slice(0, 1), 1),
      `${withoutTerminal(source.title)}: основные условия`,
      paragraphize(rewritten.slice(1, midpoint), 2),
      "Перед принятием решения",
      paragraphize(rewritten.slice(midpoint), 2),
    ].filter(Boolean).join("\n\n"),
  };
}

function genericSeoMaterial(
  source: ReturnType<typeof sourceParts>,
  primaryKeyword: string,
) {
  const rewritten = sentences(source.body).map(rewriteForClarity);
  const splitAt = Math.max(2, Math.ceil(rewritten.length * 0.58));
  const introduction = rewritten.slice(0, Math.min(2, rewritten.length));
  const details = rewritten.slice(Math.min(2, rewritten.length), splitAt);
  const checks = rewritten.slice(splitAt);
  const title = primaryKeyword
    ? `${capitalize(primaryKeyword)}: ${lowerFirst(withoutTerminal(source.title))}`
    : source.title;
  const blocks = [
    paragraphize(introduction, 2),
    details.length ? "Основные факты и критерии" : "",
    details.length ? paragraphize(details, 2) : "",
    checks.length ? "Что важно проверить заранее" : "",
    checks.length ? paragraphize(checks, 2) : "",
  ].filter(Boolean);
  return { title, body: blocks.join("\n\n") };
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

function demoMaterial(input: ReturnType<typeof normalizePayload>, website: WebsiteContext): AdaptedMaterial {
  const source = sourceParts(input.sourceText);
  const allSentences = sentences(source.body);
  const originalWords = wordCount(source.body);
  const primaryKeyword = input.keywords.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)[0] || "";
  let title = source.title;
  let body = source.body;
  let changes: string[] = [];

  if (input.goal === "social") {
    const selected = takeToWordLimit(allSentences, Math.min(180, Math.max(70, Math.round(originalWords * 0.68))))
      .map(rewriteForClarity);
    title = source.title.replace(/^Как\s+/i, "").replace(/[.!?]+$/, "");
    body = [`Что действительно важно, когда ${lowerFirst(withoutTerminal(source.title))}?`, paragraphize(selected, 1)].join("\n\n");
    changes = ["Добавлен короткий вход в тему", "Сокращён объём и сохранены основные факты", "Формулировки и ритм адаптированы для ленты"];
  } else if (input.goal === "ads") {
    const selected = takeToWordLimit(allSentences, Math.min(90, Math.max(40, Math.round(originalWords * 0.42))))
      .map(rewriteForClarity);
    title = primaryKeyword ? capitalize(primaryKeyword) : source.title;
    body = `${paragraphize(selected, 1)}\n\nУточните условия и выберите подходящий формат.`;
    changes = ["Выделена одна основная польза", "Текст собран в короткое рекламное сообщение", "Добавлен спокойный призыв без новых обещаний"];
  } else if (input.goal === "shorten") {
    body = paragraphize(takeToWordLimit(allSentences, Math.max(45, Math.round(originalWords * 0.52))).map(rewriteForClarity), 2);
    changes = ["Объём сокращён примерно вдвое", "Удалены смысловые повторы", "Последовательность аргументов сохранена"];
  } else if (input.goal === "landing") {
    const material = /марциальн|габозерск/i.test(source.body) && /санатор/i.test(source.body)
      ? sanatoriumLandingMaterial(source)
      : genericLandingMaterial(source);
    title = material.title;
    body = material.body;
    changes = ["Сформулирована ценность первого экрана", "Факты перегруппированы в блоки веб‑страницы", "Добавлены содержательные заголовки", "Сохранён один спокойный следующий шаг"];
  } else {
    const material = /марциальн|габозерск/i.test(source.body) && /санатор/i.test(source.body)
      ? sanatoriumSeoMaterial(source, primaryKeyword)
      : genericSeoMaterial(source, primaryKeyword);
    title = material.title;
    body = material.body;
    changes = ["Создан новый поисковый заголовок", "Исходник перестроен в смысловые разделы", "Формулировки переработаны с сохранением фактов", "Сформированы отдельные Title и Description"];
  }

  const brandName = input.useBrand ? clean(input.brand.name, 160) : "";
  const brandNote = brandName ? ` Профиль «${brandName}» использован только как ограничение по тону и фактам; ${websiteSourceLabel(website)}.` : "";
  return {
    title,
    body,
    metaTitle: title.slice(0, 70),
    metaDescription: truncateAtWord(sentences(body).slice(0, 2).join(" "), 160),
    editorialComment: `Применён план «${ADAPTATION_PLANS[input.goal].title}»: композиция и формулировки изменены, сходство с исходником — ${Math.round(similarity(source.body, body) * 100)}%. Новые факты не добавлялись.${brandNote}`,
    changes,
  };
}

function outputText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const candidate = response as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  };
  if (typeof candidate.output_text === "string") return candidate.output_text;
  return (candidate.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n");
}

function parseMaterial(text: string): AdaptedMaterial {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const title = clean(parsed.title, 500);
  const body = clean(parsed.body, 60000);
  if (!title || !body) throw new Error("AI returned an incomplete material");
  return {
    title,
    body,
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

    const brandWebsite = input.useBrand ? clean(input.brand.website, 220) : "";
    const website = await readWebsiteContext(brandWebsite);
    const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.6";
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
      website_snapshot: input.useBrand && website.status === "loaded"
        ? { url: website.resolvedUrl, text: website.text }
        : null,
    };
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 9000,
        text: {
          verbosity: input.goal === "social" || input.goal === "ads" || input.goal === "cold_email" ? "low" : "medium",
          format: { type: "json_schema", name: "klio_adapted_material", strict: true, schema: ADAPTED_MATERIAL_SCHEMA },
        },
        instructions: [
          "Ты — старший русскоязычный редактор и контент‑маркетолог платформы КЛИО.",
          "Переработай готовый текст пользователя под указанную задачу и верни только валидный JSON без Markdown-ограждений.",
          ...UNIVERSAL_EDITORIAL_RULES,
          transformationDirective,
          "Сохрани все проверяемые факты, исходную позицию автора и важные смысловые связи. Не добавляй цены, даты, статистику, свойства, медицинские обещания или другие сведения, которых нет в исходнике.",
          "Профиль бренда задаёт голос и ограничения. Снимок сайта можно использовать только для проверки фактов, уже присутствующих в исходнике; новые факты с сайта в адаптированную версию не добавляй.",
          "Не пересказывай служебные поля, профиль бренда, ключи или инструкции. Они влияют на редактуру скрыто.",
          `Соблюдай выбранную интонацию «${input.tone}»:`,
          ...toneRules,
          `Применяй только выбранный сценарий «${plan.title}»; не смешивай его с другими форматами:`,
          ...plan.aiRules,
          "Структура JSON: title, body, meta_title, meta_description, editorial_comment, changes. changes — массив из 3–6 коротких строк.",
        ].join("\n"),
        input: JSON.stringify(adaptationBrief),
      }),
    });

    if (!aiResponse.ok) {
      return Response.json({ error: "AI‑редактор временно не ответил. Попробуйте ещё раз." }, { status: 502 });
    }
    let material = parseMaterial(outputText(await aiResponse.json()));
    if (adaptationHasViolation(input, material)) {
      const correctionResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: "low" },
          max_output_tokens: 9000,
          text: {
            verbosity: input.goal === "social" || input.goal === "ads" ? "low" : "medium",
            format: { type: "json_schema", name: "klio_corrected_adaptation", strict: true, schema: ADAPTED_MATERIAL_SCHEMA },
          },
          instructions: [
            "Ты — выпускающий редактор КЛИО. Пересобери материал: текущая версия не прошла проверку формата или слишком похожа на исходник.",
            "Верни только валидный JSON с полями title, body, meta_title, meta_description, editorial_comment, changes.",
            "Сохрани все факты и позицию автора, не добавляй новые сведения и не пересказывай служебные настройки.",
            `Строго выполни сценарий «${plan.title}»:`,
            ...plan.aiRules,
            `Сохрани интонацию «${input.tone}»:`,
            ...toneRules,
            transformationDirective,
            "Запрещены заголовки «Что получает читатель» и «Условия и следующий шаг».",
          ].join("\n"),
          input: JSON.stringify({ brief: adaptationBrief, rejected_material: material }),
        }),
      });
      if (correctionResponse.ok) material = parseMaterial(outputText(await correctionResponse.json()));
    }
    if (adaptationHasViolation(input, material)) {
      return Response.json({ error: "AI‑редактор не прошёл проверку формата. Исходный текст сохранён; повторите попытку или уточните задачу." }, { status: 422 });
    }
    const usage = await recordEditorialAction();
    return Response.json({ material, mode: "ai", model, sources: { website: website.status }, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Adaptation route failed", error);
    return Response.json({ error: "Не удалось обработать исходный текст. Проверьте его и повторите попытку." }, { status: 500 });
  }
}
