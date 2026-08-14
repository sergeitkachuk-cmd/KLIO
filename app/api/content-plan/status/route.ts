import { getAsyncJob } from "../../_lib/async-jobs";
import { workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";

// Polled by the client every few seconds while a content-plan job (started
// via POST /api/content-plan, which now only returns a jobId) runs in the
// background — see app/api/_lib/async-jobs.ts for why the actual AI call
// isn't kept inside that first request anymore.
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "Не передан идентификатор задания." }, { status: 400 });

    const identity = await workspaceIdentity();
    // getAsyncJob scopes the lookup to (id, ownerEmail) — a job id from
    // another account simply won't match, same as a 404.
    const job = await getAsyncJob(id, identity.email);
    if (!job || job.kind !== "content_plan") {
      return Response.json({ error: "Задание не найдено." }, { status: 404 });
    }

    if (job.status === "done") {
      return Response.json({ status: "done", ...JSON.parse(job.resultJson ?? "{}") });
    }
    if (job.status === "failed") {
      return Response.json({ status: "failed", error: job.errorMessage || "Не удалось собрать контент‑план." });
    }
    return Response.json({ status: job.status });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("content-plan status check failed", error);
    return Response.json({ error: "Не удалось проверить статус задания." }, { status: 500 });
  }
}
