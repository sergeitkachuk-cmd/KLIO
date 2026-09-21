import { and, eq } from "drizzle-orm";
import { brands } from "../../../db/schema";
import { callAiModel } from "./ai-router";
import { createCarouselSlideImage } from "./image-generation";
import { downloadBrandLogo } from "./storage";
import { getWorkspaceDb, recordGeneration, WorkspaceAccessError } from "./workspace-account";
import { failAsyncJob, markAsyncJobProcessing } from "./async-jobs";

export const CAROUSEL_MIN_SLIDES = 3;
export const CAROUSEL_MAX_SLIDES = 8;
// Pinned dated snapshot, same reasoning as image-generation.ts's own
// default (a bare rolling alias could change what this feature was
// actually tested against without any code change here).
export const CAROUSEL_IMAGE_MODEL = "gpt-image-2.5-flare-2026-09-08";

const slideSchema = {
  type: "object",
  properties: {
    headline: { type: "string" },
    subtext: { type: "string" },
  },
  required: ["headline", "subtext"],
  additionalProperties: false,
} as const;

function carouselSchema(count: number) {
  return {
    type: "object",
    properties: {
      slides: { type: "array", minItems: count, maxItems: count, items: slideSchema },
    },
    required: ["slides"],
    additionalProperties: false,
  };
}

// Same editorial-structuring framing generate_content_plan already uses
// for topics - a real arc (hook, points in descending priority, payoff),
// not paragraphs chopped at even intervals.
function buildInstructions(count: number): string {
  return [
    "Ты редактор, который превращает готовый текст в карусель для соцсетей (Instagram/VK, несколько слайдов подряд).",
    `Разбей присланный текст ровно на ${count} слайдов.`,
    "Каждый слайд: headline — короткий цепляющий заголовок (до 8 слов), subtext — одна поддерживающая строка (до 14 слов). Это готовый текст для картинки, без кавычек, без нумерации слайдов, без markdown.",
    "Собери настоящую карусель, а не текст, порезанный на равные куски: первый слайд — цепляющий хук по теме, средние слайды — по одному ключевому тезису на слайд от самого важного к деталям, последний слайд — вывод или явный призыв к действию.",
    "Опирайся только на факты из присланного текста, не добавляй то, чего там нет.",
  ].join("\n");
}

export type CarouselInput = {
  text: string;
  slideCount: number;
  brandId?: string;
  useLogo?: boolean;
  baseUrl: string;
};

export type CarouselSlide = { headline: string; subtext: string; imageUrl: string };

// Runs in the background after the route responds - see async-jobs.ts for
// why `void`-ing this is safe on this host, and runMaterialGenerationJob
// in generate/route.ts for the identical shape this mirrors: mark
// processing, do the work, complete or fail the job, never thrown back to
// whoever kicked it off.
export async function runCarouselGeneration(jobId: string, input: CarouselInput, ownerEmail: string) {
  try {
    await markAsyncJobProcessing(jobId);
    const count = input.slideCount;

    const answer = await callAiModel<{ slides: Array<{ headline: string; subtext: string }> }>({
      operation: "generate_carousel_slides",
      ownerEmail,
      brandId: input.brandId,
      schemaName: "klio_carousel_slides",
      schema: carouselSchema(count),
      instructions: buildInstructions(count),
      input: JSON.stringify({ text: input.text.slice(0, 12_000) }),
    });
    const slideText = answer.result.slides;
    if (slideText.length !== count) throw new Error("ИИ вернул неверное количество слайдов карусели.");

    // Same lookup api/images/route.ts and api/dialogue/route.ts already do
    // for their own useLogo option - brandId alone doesn't imply a logo
    // exists or was asked for.
    let logo: { bytes: Uint8Array<ArrayBuffer>; contentType: string } | undefined;
    if (input.useLogo && input.brandId) {
      const db = await getWorkspaceDb();
      const [brand] = await db.select({ profileJson: brands.profileJson }).from(brands)
        .where(and(eq(brands.id, input.brandId), eq(brands.ownerEmail, ownerEmail))).limit(1);
      const profile = brand ? JSON.parse(brand.profileJson) as { logoKey?: unknown } : null;
      if (typeof profile?.logoKey === "string" && profile.logoKey) logo = await downloadBrandLogo(profile.logoKey);
    }

    // Slide 1 references the logo (if requested) - the same "weave it in
    // naturally" treatment createImageFromLogo already gives a single
    // image. Every slide after that references the PREVIOUS slide's own
    // bytes for style/composition consistency instead of re-anchoring to
    // slide 1 every time, so drift accumulates less across a longer
    // carousel - see createCarouselSlideImage's own comment for why the
    // wording differs between these two reference purposes. A text
    // reminder is added for slides 2+ too when a logo was used, since the
    // image reference alone doesn't guarantee the logo itself survives
    // the "match this style" instruction as reliably as it does on the
    // slide that referenced it directly.
    const slides: CarouselSlide[] = [];
    let reference: { bytes: Uint8Array<ArrayBuffer>; contentType: string; kind: "logo" | "previous-slide" } | undefined = logo && { ...logo, kind: "logo" };
    for (let index = 0; index < slideText.length; index++) {
      const slide = slideText[index];
      const logoReminder = logo && index > 0 ? " Сохраняй тот же логотип бренда и фирменный стиль, что и на предыдущих слайдах." : "";
      const prompt = `Слайд ${index + 1} из ${count} карусели для соцсетей, как обложка к статье: крупный заголовок и короткая поддерживающая строка, единой композицией с фоном.${logoReminder}\nЗаголовок: «${slide.headline}»\nПодзаголовок: «${slide.subtext}»`;
      let generated;
      try {
        generated = await createCarouselSlideImage(prompt, reference, ownerEmail, input.baseUrl, `${jobId}-${index}`, {}, CAROUSEL_IMAGE_MODEL);
      } catch (error) {
        throw new Error(`Не удалось создать слайд ${index + 1} из ${count} — генерация карусели остановлена. ${error instanceof Error ? error.message : ""}`.trim());
      }
      slides.push({ headline: slide.headline, subtext: slide.subtext, imageUrl: generated.url });
      reference = { bytes: generated.bytes, contentType: generated.contentType, kind: "previous-slide" };
    }

    const title = slides[0]?.headline.slice(0, 100) || "Карусель";
    const usage = await recordGeneration({
      brandId: input.brandId,
      format: "external",
      topic: "Карусель",
      title,
      body: input.text.slice(0, 4000),
      subtitle: "",
      metaTitle: "",
      metaDescription: "",
      editorialComment: "",
      keywords: "",
      tone: "",
      targetLength: 0,
      imageUrl: slides[0]?.imageUrl ?? "",
      slidesJson: JSON.stringify(slides),
    }, { id: jobId, result: { slides } }, count);
    if (!usage) throw new WorkspaceAccessError("Хранилище кабинета недоступно.", 503);
  } catch (error) {
    const message = error instanceof WorkspaceAccessError ? error.message : error instanceof Error ? error.message : "Не удалось создать карусель. Попробуйте ещё раз.";
    if (!(error instanceof WorkspaceAccessError)) console.error("carousel background job failed", error);
    await failAsyncJob(jobId, message);
  }
}
