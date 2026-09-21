import { and, eq } from "drizzle-orm";
import { generations } from "../../../db/schema";
import { aiConfigured } from "../_lib/ai-config";
import { imageConfigured } from "../_lib/image-generation";
import { CAROUSEL_MAX_SLIDES, CAROUSEL_MIN_SLIDES, runCarouselGeneration } from "../_lib/carousel";
import { claimAsyncJob, failAsyncJob } from "../_lib/async-jobs";
import { hasUnsafeRequestOrigin } from "../_lib/request-origin";
import { isAiRateLimited } from "../_lib/rate-limit";
import { readBoundedJson, RequestBodyError } from "../_lib/request-body";
import { resolveBaseUrl } from "../_lib/base-url";
import { ensureAccount, getWorkspaceDb, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";
import { planRule } from "../../plans";

// Same shape as app/api/generate/route.ts (see its own comment on
// runMaterialGenerationJob): a request this long-running (one LLM call
// plus up to CAROUSEL_MAX_SLIDES sequential image calls) can't trust a
// hosting platform's own reverse-proxy timeout to stay open end to end, so
// the route only starts the job and returns a jobId; the actual work runs
// in runCarouselGeneration, polled via GET below.
const CAROUSEL_TIMEOUT_MS = 60_000 + CAROUSEL_MAX_SLIDES * 45_000;

type CarouselPayload = {
  generationId?: unknown;
  text?: unknown;
  slideCount?: unknown;
  brandId?: unknown;
};

export async function POST(request: Request) {
  try {
    if (hasUnsafeRequestOrigin(request)) return Response.json({ error: "Недопустимый источник запроса." }, { status: 403 });
    if (isAiRateLimited(request, "carousel", 4)) return Response.json({ error: "Слишком много запусков подряд. Подождите минуту и повторите." }, { status: 429 });

    const identity = await workspaceIdentity();
    const raw = await readBoundedJson(request, 50_000) as CarouselPayload;
    const slideCount = Math.round(Number(raw.slideCount));
    if (!Number.isFinite(slideCount) || slideCount < CAROUSEL_MIN_SLIDES || slideCount > CAROUSEL_MAX_SLIDES) {
      return Response.json({ error: `Число слайдов — от ${CAROUSEL_MIN_SLIDES} до ${CAROUSEL_MAX_SLIDES}.` }, { status: 400 });
    }
    const brandId = typeof raw.brandId === "string" && raw.brandId.trim() ? raw.brandId.trim() : undefined;

    let text = "";
    const generationId = typeof raw.generationId === "string" ? raw.generationId.trim() : "";
    if (generationId) {
      const db = await getWorkspaceDb();
      const [source] = await db.select({ title: generations.title, body: generations.body })
        .from(generations)
        .where(and(eq(generations.id, generationId), eq(generations.ownerEmail, identity.email)))
        .limit(1);
      if (!source) return Response.json({ error: "Материал не найден или недоступен." }, { status: 404 });
      text = [source.title, source.body].filter(Boolean).join("\n\n");
    } else if (typeof raw.text === "string") {
      text = raw.text;
    }
    text = text.trim();
    if (text.length < 20) return Response.json({ error: "Добавьте текст статьи или вставьте свой текст — этого недостаточно для карусели." }, { status: 400 });

    if (!aiConfigured("generate_carousel_slides") || !imageConfigured()) {
      return Response.json({ error: "Генерация карусели пока недоступна." }, { status: 503 });
    }

    // Checked up front, synchronously, so an account that's already short
    // on quota gets a clean 429 immediately instead of a job that burns
    // real provider calls only to fail the final debit at the very end
    // (see recordGeneration's own atomic check in carousel.ts, which stays
    // the authoritative guard — this is only a fast-fail convenience).
    const account = await ensureAccount(identity);
    const rule = planRule(account.planId);
    if (account.generationsUsed + slideCount > rule.generationLimit) {
      return Response.json({ error: `Недостаточно квоты: нужно ${slideCount}, доступно ${Math.max(0, rule.generationLimit - account.generationsUsed)} из ${rule.generationLimit} материалов ${rule.periodLabel}.` }, { status: 429 });
    }

    const input = { text, slideCount, brandId, baseUrl: resolveBaseUrl(request) };
    const job = await claimAsyncJob("carousel_generation", identity.email, input, CAROUSEL_TIMEOUT_MS + 10_000);
    if (job.reused) return Response.json({ jobId: job.id, reused: true });

    // Quota may have changed while waiting for the owner's job gate.
    const recheck = await ensureAccount(identity);
    if (recheck.generationsUsed + slideCount > rule.generationLimit) {
      await failAsyncJob(job.id, "Не удалось подтвердить доступную квоту.").catch(() => {});
      return Response.json({ error: "Недостаточно квоты для этой карусели." }, { status: 429 });
    }

    // Intentionally not awaited - see async-jobs.ts for why this keeps
    // running after the response below is sent on this host.
    void runCarouselGeneration(job.id, input, identity.email);
    return Response.json({ jobId: job.id });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Carousel route failed to start", error);
    return Response.json({ error: "Не удалось запустить генерацию карусели." }, { status: 500 });
  }
}
