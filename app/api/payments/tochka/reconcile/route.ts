import { and, eq } from "drizzle-orm";
import { accounts, payments } from "../../../../../db/schema";
import { getWorkspaceDb, workspaceIdentity, WorkspaceAccessError } from "../../../_lib/workspace-account";
import { tochkaRequest, TochkaConfigError } from "../../../_lib/tochka";
import { subscriptionExpiry } from "../../../_lib/subscription";
import type { BillingPeriod } from "../../../../billing-pricing";

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
    const input = await request.json().catch(() => ({}));
    const paymentLinkId = typeof input.paymentLinkId === "string" ? input.paymentLinkId : "";
    if (!paymentLinkId) return Response.json({ error: "Не указан идентификатор платежа." }, { status: 400 });
    const db = await getWorkspaceDb();
    const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentLinkId), eq(payments.ownerEmail, user.email))).limit(1);
    if (!payment) return Response.json({ error: "Платёж не найден." }, { status: 404 });
    if (!payment.operationId) return Response.json({ status: "pending" });

    const operation = await tochkaRequest<unknown>(`/acquiring/v1.0/payments/${encodeURIComponent(payment.operationId)}`);
    const providerStatus = statusOf(operation)?.toUpperCase();
    if (providerStatus === "REFUNDED" || providerStatus === "REFUNDED_PARTIALLY") {
      const now = new Date();
      let revoked = false;
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(payments).where(eq(payments.id, paymentLinkId)).limit(1);
        if (!current || (current.status !== "paid" && current.status !== "refunded")) return;
        const [updatedPayment] = current.status === "paid"
          ? await tx.update(payments).set({ status: "refunded", updatedAt: now.toISOString() })
            .where(and(eq(payments.id, paymentLinkId), eq(payments.status, "paid"))).returning()
          : [current];
        if (!updatedPayment) return;
        // A refund revokes the access granted by this purchase. Do not touch an
        // account that has a newer successful payment.
        const successful = await tx.select({ id: payments.id, paidAt: payments.paidAt }).from(payments)
          .where(and(eq(payments.ownerEmail, updatedPayment.ownerEmail), eq(payments.status, "paid")));
        const refundedAt = new Date(updatedPayment.paidAt || updatedPayment.createdAt).getTime();
        const hasNewerPayment = successful.some((item) => new Date(item.paidAt || 0).getTime() > refundedAt);
        // A refund, whether full or partial, closes the subscription period
        // attached to this purchase. Keep the plan id but expire it now: this
        // blocks access without incorrectly granting a fresh trial allowance.
        if (!hasNewerPayment) {
          await tx.update(accounts).set({ planId: updatedPayment.planId, planExpiresAt: now.toISOString(), updatedAt: now.toISOString() })
            .where(eq(accounts.email, updatedPayment.ownerEmail));
          revoked = true;
        }
      });
      return Response.json({ status: "refunded", revoked });
    }
    if (providerStatus !== "APPROVED") return Response.json({ status: payment.status });
    if (payment.status === "paid") return Response.json({ status: "paid" });

    const now = new Date();
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(payments).where(eq(payments.id, paymentLinkId)).limit(1);
      if (!current || current.status === "paid" || current.status === "refunded") return;
      const [account] = await tx.select().from(accounts).where(eq(accounts.email, current.ownerEmail)).limit(1);
      const [confirmedPayment] = await tx.update(payments).set({ status: "paid", paidAt: now.toISOString(), updatedAt: now.toISOString() }).where(and(eq(payments.id, paymentLinkId), eq(payments.status, "pending"))).returning();
      if (!confirmedPayment) return;
      await tx.update(accounts).set({ planId: confirmedPayment.planId, planExpiresAt: subscriptionExpiry(account?.planExpiresAt, confirmedPayment.billing as BillingPeriod, now), generationsUsed: 0, researchUsed: 0, editorActionsUsed: 0, generationMonth: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`, updatedAt: now.toISOString() }).where(eq(accounts.email, confirmedPayment.ownerEmail));
    });
    return Response.json({ status: "paid" });
  } catch (error) {
    if (error instanceof WorkspaceAccessError || error instanceof TochkaConfigError) return Response.json({ error: error.message }, { status: error instanceof WorkspaceAccessError ? error.status : 503 });
    console.error("Tochka payment reconciliation failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Не удалось проверить оплату." }, { status: 502 });
  }
}
