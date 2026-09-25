// Hit on a timer (Timeweb's own scheduled-task panel, or an external pinger
// like cron-job.org) to fire every publication whose scheduledAt has
// arrived — this app has no in-process scheduler of its own (see
// api/_lib/async-jobs.ts's job-per-request model, which only covers work
// kicked off by an actual visitor request). Protected by a shared secret
// header rather than a session: nobody visiting the site is meant to call
// this, only the external scheduler that knows CRON_SECRET.
//
// Safe to call more often than strictly needed, or from more than one
// scheduler by mistake — attemptPublish() claims each row atomically
// (scheduled -> publishing) before doing anything, so an overlapping or
// duplicate call just finds nothing left to claim on the rows the first
// call already picked up.

import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { payments, publications } from "../../../../db/schema";
import { getWorkspaceDb, workspaceDatabaseAvailable } from "../../_lib/workspace-account";
import { attemptPublish } from "../../_lib/publish-attempt";
import { resolveBaseUrl } from "../../_lib/base-url";
import { tochkaRequest } from "../../_lib/tochka";
import { confirmTochkaPayment } from "../../_lib/confirm-tochka-payment";

// Bounds how much work one invocation does — a scheduler firing every
// minute will always keep the backlog near zero in practice, this just
// keeps a single request from running away if it's ever down for a while.
const BATCH_SIZE = 20;
const PAYMENT_BATCH_SIZE = 12;

function paymentStatus(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map(paymentStatus).find(Boolean);
  const record = value as Record<string, unknown>;
  if (typeof record.status === "string") return record.status;
  return Object.values(record).map(paymentStatus).find(Boolean);
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("x-cron-secret") === secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 });
  if (!await workspaceDatabaseAvailable()) return Response.json({ error: "Хранилище недоступно." }, { status: 503 });

  const db = await getWorkspaceDb();
  const nowIso = new Date().toISOString();
  const stalePayments = await db.select({ id: payments.id, operationId: payments.operationId }).from(payments).where(and(
    eq(payments.status, "pending"),
    isNotNull(payments.operationId),
    isNotNull(payments.paymentUrl),
    sql`${payments.updatedAt}::timestamptz <= CURRENT_TIMESTAMP - INTERVAL '5 minutes'`,
    sql`${payments.createdAt}::timestamptz >= CURRENT_TIMESTAMP - INTERVAL '3 days'`,
  )).orderBy(asc(payments.updatedAt)).limit(PAYMENT_BATCH_SIZE);
  let paymentsApproved = 0;
  let paymentChecksFailed = 0;
  await Promise.all(stalePayments.map(async (payment) => {
    try {
      const operation = await tochkaRequest<unknown>(`/acquiring/v1.0/payments/${encodeURIComponent(payment.operationId!)}`);
      const providerStatus = paymentStatus(operation)?.toUpperCase();
      if (providerStatus === "APPROVED") {
        const confirmed = await confirmTochkaPayment(db, payment.id, payment.operationId!);
        if (confirmed === "paid") paymentsApproved += 1;
      }
    } catch (error) {
      paymentChecksFailed += 1;
      console.error("publish-due: Tochka payment check failed", payment.id, error instanceof Error ? error.message : "unknown error");
    } finally {
      await db.update(payments).set({ updatedAt: new Date().toISOString() }).where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
    }
  }));
  // A stopped container cannot report its last outbound request's outcome.
  // Recover visibility, never replay an uncertain external side effect.
  await db.update(publications).set({
    status: "failed",
    errorMessage: "Подтверждение публикации не получено после остановки или зависания обработки. Сначала проверьте канал; автоматическая повторная отправка отключена.",
    updatedAt: nowIso,
  }).where(and(eq(publications.status, "publishing"), sql`${publications.updatedAt}::timestamptz <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'`));
  // Only ever "scheduled" — a "failed" row (retries already exhausted) is
  // never picked back up by the poller. Only explicit publish_now retries
  // it; saving a new date must not replay uncertain/partial delivery.
  const due = await db.select({ id: publications.id, ownerEmail: publications.ownerEmail }).from(publications).where(and(
    eq(publications.status, "scheduled"),
    lte(publications.scheduledAt, nowIso),
  )).orderBy(asc(publications.scheduledAt)).limit(BATCH_SIZE);

  const workspaceUrl = `${resolveBaseUrl(request)}/workspace`;
  const results = await Promise.all(due.map(async (row) => {
    try {
      const outcome = await attemptPublish(row.id, row.ownerEmail, workspaceUrl);
      return { id: row.id, outcome: outcome?.status ?? "skipped" };
    } catch (error) {
      // attemptPublish already persists a failure status itself — this
      // catch only exists so one row throwing an unexpected error (a bug,
      // not a normal PublishError) can't take the rest of the batch down
      // with it via Promise.all.
      console.error("publish-due: unexpected error attempting", row.id, error);
      return { id: row.id, outcome: "error" };
    }
  }));

  return Response.json({ processed: results.length, results, paymentsChecked: stalePayments.length, paymentsApproved, paymentChecksFailed });
}

// GET mirrors POST — some cron dashboards only offer GET pings. Same
// secret check, same behavior.
export async function GET(request: Request) {
  return POST(request);
}
