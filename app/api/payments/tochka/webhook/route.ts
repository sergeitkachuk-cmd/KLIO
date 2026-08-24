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

// The success path used to log nothing at all — after a real payment went
// unconfirmed with zero trace of the webhook ever arriving, every branch
// below now logs something, so "did Tochka even call us" is a log search
// away instead of a guess next time.
export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const claims = await verifyTochkaWebhook(raw);
    if (!claims || claims.webhookType !== "acquiringInternetPayment") {
      console.error("Tochka webhook rejected: bad signature or unexpected type", claims?.webhookType ?? "(signature failed)");
      return new Response(null, { status: 400 });
    }
    if (claims.status !== "APPROVED") {
      console.log("Tochka webhook received, ignoring non-APPROVED status", claims.status, stringClaim(claims.paymentLinkId));
      return new Response(null, { status: 200 });
    }

    const paymentLinkId = stringClaim(claims.paymentLinkId);
    const operationId = stringClaim(claims.operationId);
    const amountKopecks = numericAmount(claims.amount);
    if (!paymentLinkId || !operationId || amountKopecks === null) {
      console.error("Tochka webhook missing required claims", { paymentLinkId, operationId, amount: claims.amount });
      return new Response(null, { status: 400 });
    }

    const db = await getWorkspaceDb();
    let outcome: "confirmed" | "already_processed" | "unknown_payment" = "unknown_payment";
    await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentLinkId)).limit(1);
      if (!payment) return;
      if (payment.status === "paid" || payment.status === "refunded") { outcome = "already_processed"; return; }
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
      outcome = "confirmed";
    });
    console.log("Tochka webhook processed", outcome, paymentLinkId, operationId);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Tochka webhook failed", error instanceof Error ? error.message : "unknown error");
    return new Response(null, { status: 500 });
  }
}
