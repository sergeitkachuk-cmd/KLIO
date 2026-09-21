import { failAsyncJob, getAsyncJob } from "../../_lib/async-jobs";
import { workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";

// Polled by the client every few seconds while a carousel-generation job
// (started via POST /api/carousel, which only returns a jobId) runs in the
// background — identical pattern to app/api/generate/status/route.ts, see
// its own comment and app/api/_lib/async-jobs.ts for why.
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "Не передан идентификатор задания." }, { status: 400 });

    const identity = await workspaceIdentity();
    const job = await getAsyncJob(id, identity.email);
    if (!job || job.kind !== "carousel_generation") {
      return Response.json({ error: "Задание не найдено." }, { status: 404 });
    }

    if (job.status === "done") {
      return Response.json({ status: "done", ...JSON.parse(job.resultJson ?? "{}") });
    }
    if (job.status === "failed") {
      return Response.json({ status: "failed", error: job.errorMessage || "Не удалось создать карусель." });
    }
    // Sized for up to CAROUSEL_MAX_SLIDES sequential image calls plus the
    // one LLM call - bigger than generate/status's 130s budget for a
    // single material, comfortably under the client's own 6-minute poll
    // ceiling (pollAsyncJob in textora-experience.tsx).
    const updatedAt = Date.parse(job.updatedAt);
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt > 320_000) {
      const message = "Генерация карусели превысила лимит времени. Запустите её ещё раз — предыдущий запрос не будет повторён автоматически.";
      await failAsyncJob(job.id, message, job.updatedAt);
      // Completion may have committed after our initial read. Never report
      // a saved, atomically completed result as a timeout.
      const settled = await getAsyncJob(job.id, identity.email);
      if (settled?.status === "done") return Response.json({ status: "done", ...JSON.parse(settled.resultJson ?? "{}") });
      if (settled?.status === "pending" || settled?.status === "processing") return Response.json({ status: settled.status });
      return Response.json({ status: "failed", error: message }, { status: 504 });
    }
    return Response.json({ status: job.status });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("carousel status check failed", error);
    return Response.json({ error: "Не удалось проверить статус задания." }, { status: 500 });
  }
}
