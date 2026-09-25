import { eq, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { payments } from "../../../../db/schema";
import { requireAdminUser } from "../../_lib/admin";
import { confirmTochkaPayment } from "../../_lib/confirm-tochka-payment";
import { readBoundedJson, RequestBodyError } from "../../_lib/request-body";
import { tochkaRequest, TochkaConfigError } from "../../_lib/tochka";

export const runtime = "nodejs";

function statusOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map(statusOf).find(Boolean);
  const record = value as Record<string, unknown>;
  if (typeof record.status === "string") return record.status;
  return Object.values(record).map(statusOf).find(Boolean);
}

/** Admin recovery when Tochka's webhook did not reach KLIO. */
export async function POST(request: Request) {
  if (!await requireAdminUser()) return Response.json({ error: "Недоступно." }, { status: 404 });
  try {
    const input = await readBoundedJson(request, 4096);
    const paymentId = typeof input.paymentId === "string" ? input.paymentId.trim() : "";
    const operationId = typeof input.operationId === "string" ? input.operationId.trim() : "";
    const reference = paymentId || operationId;
    if (!reference || reference.length > 120) return Response.json({ error: "Не указан ID платежа или операции." }, { status: 400 });

    const db = getDb();
    const [payment] = await db.select().from(payments)
      .where(or(eq(payments.id, reference), eq(payments.operationId, reference))).limit(1);
    if (!payment) return Response.json({ error: "Платёж не найден." }, { status: 404 });
    if (!payment.operationId) return Response.json({ status: payment.status, error: "У платежа ещё нет ID операции Точки." }, { status: 409 });

    const operation = await tochkaRequest<unknown>(`/acquiring/v1.0/payments/${encodeURIComponent(payment.operationId)}`);
    const providerStatus = statusOf(operation)?.toUpperCase() ?? "UNKNOWN";
    if (providerStatus !== "APPROVED") return Response.json({ status: payment.status, providerStatus });

    const preserveAccess = input.preserveAccess === true;
    const status = await confirmTochkaPayment(db, payment.id, payment.operationId, { grantAccess: !preserveAccess });
    return Response.json({ status, providerStatus, preservedAccess: preserveAccess });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof TochkaConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.error("Admin Tochka payment recovery failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Не удалось проверить оплату в Точке." }, { status: 502 });
  }
}
