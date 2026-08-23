import { and, eq } from "drizzle-orm";
import { accounts, payments } from "../../../../../db/schema";
import { getWorkspaceDb } from "../../../_lib/workspace-account";
import { verifyTochkaWebhook } from "../../../_lib/tochka";
import { subscriptionExpiry } from "../../../_lib/subscription";
import type { BillingPeriod } from "../../../../billing-pricing";

function stringClaim(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numericAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const claims = await verifyTochkaWebhook(raw);
    if (!claims || claims.webhookType !== "acquiringInternetPayment") return new Response(null, { status: 400 });
    if (claims.status !== "APPROVED") return new Response(null, { status: 200 });

    const paymentLinkId = stringClaim(claims.paymentLinkId);
    const operationId = stringClaim(claims.operationId);
    const amountKopecks = numericAmount(claims.amount);
    if (!paymentLinkId || !operationId || amountKopecks === null) return new Response(null, { status: 400 });

    const db = await getWorkspaceDb();
    await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentLinkId)).limit(1);
      if (!payment || payment.status === "paid" || payment.status === "refunded") return;
      if (payment.status !== "pending" || payment.amountKopecks !== amountKopecks) throw new Error("Payment verification failed.");
      await tx.update(payments).set({
        status: "paid",
        operationId,
        paidAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(and(eq(payments.id, paymentLinkId), eq(payments.status, "pending")));
      const [account] = await tx.select().from(accounts).where(eq(accounts.email, payment.ownerEmail)).limit(1);
      const paidAt = new Date();
      await tx.update(accounts).set({
        planId: payment.planId,
        planExpiresAt: subscriptionExpiry(account?.planExpiresAt, payment.billing as BillingPeriod, paidAt),
        generationsUsed: 0,
        researchUsed: 0,
        editorActionsUsed: 0,
        generationMonth: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`,
        updatedAt: paidAt.toISOString(),
      }).where(eq(accounts.email, payment.ownerEmail));
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Tochka webhook failed", error instanceof Error ? error.message : "unknown error");
    return new Response(null, { status: 500 });
  }
}
