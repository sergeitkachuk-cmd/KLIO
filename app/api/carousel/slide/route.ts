import { and, eq, sql } from "drizzle-orm";
import { generations } from "../../../../db/schema";
import { imageConfigured } from "../../_lib/image-generation";
import { claimAsyncJob, failAsyncJob } from "../../_lib/async-jobs";
import { hasUnsafeRequestOrigin } from "../../_lib/request-origin";
import { isAiRateLimited } from "../../_lib/rate-limit";
import { readBoundedJson, RequestBodyError } from "../../_lib/request-body";
import { resolveBaseUrl } from "../../_lib/base-url";
import { ensureAccount, getWorkspaceDb, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { planRule } from "../../../plans";
import { CAROUSEL_MAX_SLIDES, CAROUSEL_MIN_SLIDES, runCarouselSlideRegeneration } from "../../_lib/carousel";

export async function POST(request: Request) {
  try {
    if (hasUnsafeRequestOrigin(request)) return Response.json({ error: "Недопустимый источник запроса." }, { status: 403 });
    if (isAiRateLimited(request, "carousel-slide", 8)) return Response.json({ error: "Слишком много запросов. Подождите минуту и повторите." }, { status: 429 });
    const identity = await workspaceIdentity();
    const body = await readBoundedJson(request, 4000) as { generationId?: unknown; slideIndex?: unknown };
    const generationId = typeof body.generationId === "string" ? body.generationId.trim() : "";
    const slideIndex = Number(body.slideIndex);
    if (!generationId || generationId.length > 80 || !Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= CAROUSEL_MAX_SLIDES)
      return Response.json({ error: "Не удалось определить выбранный слайд." }, { status: 400 });

    const db = await getWorkspaceDb();
    const [material] = await db.select({ slidesJson: generations.slidesJson }).from(generations).where(and(
      eq(generations.id, generationId), eq(generations.ownerEmail, identity.email), sql`${generations.slidesJson} <> ''`,
    )).limit(1);
    if (!material) return Response.json({ error: "Карусель не найдена или уже недоступна." }, { status: 404 });
    let slides: unknown[];
    try { slides = JSON.parse(material.slidesJson) as unknown[]; } catch { slides = []; }
    if (!Array.isArray(slides) || slides.length < CAROUSEL_MIN_SLIDES || slides.length > CAROUSEL_MAX_SLIDES || slideIndex >= slides.length)
      return Response.json({ error: "Не удалось определить выбранный слайд." }, { status: 400 });
    if (!imageConfigured()) return Response.json({ error: "Генерация изображений сейчас недоступна." }, { status: 503 });

    const account = await ensureAccount(identity);
    const rule = planRule(account.planId);
    if (account.generationsUsed >= rule.generationLimit)
      return Response.json({ error: `Лимит тарифа «${rule.name}» исчерпан.` }, { status: 429 });

    const input = { generationId, slideIndex, baseUrl: resolveBaseUrl(request) };
    const job = await claimAsyncJob("carousel_slide_regeneration", identity.email, input, 320_000);
    if (job.reused) return Response.json({ jobId: job.id, reused: true });
    const recheck = await ensureAccount(identity);
    if (recheck.generationsUsed >= rule.generationLimit) {
      await failAsyncJob(job.id, "Недостаточно доступных генераций для обновления слайда.");
      return Response.json({ error: "Недостаточно доступных генераций для обновления слайда." }, { status: 429 });
    }
    void runCarouselSlideRegeneration(job.id, input, identity.email);
    return Response.json({ jobId: job.id });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Carousel slide regeneration route failed", error);
    return Response.json({ error: "Не удалось запустить обновление слайда." }, { status: 500 });
  }
}
