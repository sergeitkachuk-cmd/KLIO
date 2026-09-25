import { and, eq } from "drizzle-orm";
import { readBoundedJson, RequestBodyError } from "../../../_lib/request-body";
import { accounts, payments } from "../../../../../db/schema";
import { getWorkspaceDb, workspaceIdentity, WorkspaceAccessError } from "../../../_lib/workspace-account";
import { tochkaRequest, TochkaConfigError } from "../../../_lib/tochka";
import { confirmTochkaPayment } from "../../../_lib/confirm-tochka-payment";

function statusOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map(statusOf).find(Boolean);
  const record = value as Record<string, unknown>;
  if (typeof record.status === "string") return record.status;
  return Object.values(record).map(statusOf).find(Boolean);
}

export async function POST(request: Request) {
  try {
    const user = await workspaceIdentity();
    const input = await readBoundedJson(request, 4096);
    const paymentLinkId = typeof input.paymentLinkId === "string" ? input.paymentLinkId : "";
    if (!paymentLinkId) return Response.json({ error: "Не указан идентификатор платежа." }, { status: 400 });
    const db = await getWorkspaceDb();
    const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentLinkId), eq(payments.ownerEmail, user.email))).limit(1);
    if (!payment) return Response.json({ error: "Платёж не найден." }, { status: 404 });
    if (!payment.operationId) return Response.json({ status: payment.status });

    const operation = await tochkaRequest<unknown>(`/acquiring/v1.0/payments/${encodeURIComponent(payment.operationId)}`);
    const providerStatus = statusOf(operation)?.toUpperCase();
    if (providerStatus === "REFUNDED" || providerStatus === "REFUNDED_PARTIALLY") {
      const now = new Date();
      let revoked = false;
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(payments).where(eq(payments.id, paymentLinkId)).limit(1).for("update");
        if (!current || (current.status !== "paid" && current.status !== "refunded")) return;
        const [updatedPayment] = current.status === "paid"
          ? await tx.update(payments).set({ status: "refunded", updatedAt: now.toISOString() })
            .where(and(eq(payments.id, paymentLinkId), eq(payments.status, "paid"))).returning()
          : [current];
        if (!updatedPayment) return;
        await tx.select({ email: accounts.email }).from(accounts).where(eq(accounts.email, updatedPayment.ownerEmail)).limit(1).for("update");
        const successful = await tx.select({ id: payments.id, paidAt: payments.paidAt }).from(payments)
          .where(and(eq(payments.ownerEmail, updatedPayment.ownerEmail), eq(payments.status, "paid")));
        const refundedAt = new Date(updatedPayment.paidAt || updatedPayment.createdAt).getTime();
        const hasNewerPayment = successful.some((item) => new Date(item.paidAt || 0).getTime() > refundedAt);
        if (!hasNewerPayment && updatedPayment.entitlementApplied) {
          const restoredEntitlement = updatedPayment.previousPlanId
            ? {
              planId: updatedPayment.previousPlanId,
              planExpiresAt: updatedPayment.previousPlanExpiresAt,
              quotaPeriodEndsAt: updatedPayment.previousQuotaPeriodEndsAt,
              generationMonth: updatedPayment.previousGenerationMonth ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
              generationsUsed: updatedPayment.previousGenerationsUsed ?? 0,
              researchUsed: updatedPayment.previousResearchUsed ?? 0,
              editorActionsUsed: updatedPayment.previousEditorActionsUsed ?? 0,
              dialogueActionsUsed: updatedPayment.previousDialogueActionsUsed ?? 0,
            }
            : { planId: updatedPayment.planId, planExpiresAt: now.toISOString() };
          await tx.update(accounts).set({ ...restoredEntitlement, updatedAt: now.toISOString() })
            .where(eq(accounts.email, updatedPayment.ownerEmail));
          revoked = true;
        }
      });
      return Response.json({ status: "refunded", revoked });
    }
    if (providerStatus !== "APPROVED") return Response.json({ status: providerStatus === "EXPIRED" && payment.status === "pending" ? "expired" : payment.status });
    if (payment.status === "paid") return Response.json({ status: "paid" });

    const status = await confirmTochkaPayment(db, paymentLinkId, payment.operationId);
    return Response.json({ status });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError || error instanceof TochkaConfigError) return Response.json({ error: error.message }, { status: error instanceof WorkspaceAccessError ? error.status : 503 });
    console.error("Tochka payment reconciliation failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Не удалось проверить оплату." }, { status: 502 });
  }
}
