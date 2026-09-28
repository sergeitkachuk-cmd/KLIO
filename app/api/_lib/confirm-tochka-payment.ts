import { and, eq } from "drizzle-orm";
import { accounts, payments } from "../../../db/schema";
import { getDb } from "../../../db";
import { nextQuotaPeriodEnd, subscriptionExpiry } from "./subscription";
import type { BillingPeriod } from "../../billing-pricing";
import { planRule } from "../../plans";
import { billingDescription } from "../../billing-pricing";
import { adminTelegramAvailable, sendAdminTelegramMessage } from "./admin-notify";

function notifyAdminOfPayment(payment: typeof payments.$inferSelect) {
  if (!adminTelegramAvailable()) return;
  const rubles = (payment.amountKopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const text = [
    "Новая оплата в КЛИО",
    `От: ${payment.ownerEmail}`,
    `Тариф: ${planRule(payment.planId).name} (${billingDescription(payment.billing as BillingPeriod)})`,
    `Сумма: ${rubles} ₽`,
    payment.discountApplied ? "Со скидкой запуска" : null,
  ].filter(Boolean).join("\n");
  // Fire-and-forget, deliberately outside the transaction below (see its
  // own call site) - a slow or failed Telegram call must never hold open
  // or roll back the DB work that actually grants access.
  sendAdminTelegramMessage(text).catch((error) => {
    console.error("Admin payment notify failed", error instanceof Error ? error.message : error);
  });
}

/** Applies one approved Tochka payment exactly once. */
export async function confirmTochkaPayment(
  db: ReturnType<typeof getDb>,
  paymentId: string,
  operationId?: string,
  options: { grantAccess?: boolean; amountKopecks?: number } = {},
) {
  const now = new Date();
  // Set from inside the transaction only on the branch that just performed
  // a real pending -> paid transition (not the early-return "was already
  // paid/refunded" branch a couple of lines below, which returns the exact
  // same "paid" string but must never re-notify on a duplicate webhook
  // delivery) - read back after the transaction settles so the Telegram
  // call happens post-commit, never inside the open transaction.
  let justConfirmed: typeof payments.$inferSelect | null = null;
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1).for("update");
    if (!current) return "unknown" as const;
    if (current.status === "paid" || current.status === "refunded") return current.status as "paid" | "refunded";
    if (options.amountKopecks !== undefined && current.amountKopecks !== options.amountKopecks) throw new Error("Payment amount mismatch.");
    const [account] = await tx.select().from(accounts).where(eq(accounts.email, current.ownerEmail)).limit(1).for("update");
    if (!account) throw new Error("Payment account is missing.");
    if (current.operationId && operationId && current.operationId !== operationId) throw new Error("Payment operation mismatch.");
    const adminSupersededThisPayment = Boolean(account.adminPlanGrantedAt && new Date(account.adminPlanGrantedAt).getTime() > new Date(current.createdAt).getTime());
    const grantAccess = options.grantAccess ?? !adminSupersededThisPayment;

    const [confirmedPayment] = await tx.update(payments).set({
      status: "paid",
      entitlementApplied: grantAccess,
      ...(operationId ? { operationId } : {}),
      paidAt: now.toISOString(),
      previousPlanId: account.planId,
      previousPlanExpiresAt: account.planExpiresAt,
      previousQuotaPeriodEndsAt: account.quotaPeriodEndsAt,
      previousGenerationMonth: account.generationMonth,
      previousGenerationsUsed: account.generationsUsed,
      previousResearchUsed: account.researchUsed,
      previousEditorActionsUsed: account.editorActionsUsed,
      previousDialogueActionsUsed: account.dialogueActionsUsed,
      updatedAt: now.toISOString(),
    }).where(and(eq(payments.id, paymentId), eq(payments.status, "pending"))).returning();
    if (!confirmedPayment) return current.status;
    justConfirmed = confirmedPayment;

    if (grantAccess) {
      await tx.update(accounts).set({
        planId: confirmedPayment.planId,
        planExpiresAt: subscriptionExpiry(account.planExpiresAt, confirmedPayment.billing as BillingPeriod, now),
        generationsUsed: 0,
        researchUsed: 0,
        editorActionsUsed: 0,
        dialogueActionsUsed: 0,
        generationMonth: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
        quotaPeriodEndsAt: nextQuotaPeriodEnd(now),
        ...(confirmedPayment.discountApplied ? { launchDiscountUsedAt: now.toISOString() } : {}),
        updatedAt: now.toISOString(),
      }).where(eq(accounts.email, confirmedPayment.ownerEmail));
    } else if (confirmedPayment.discountApplied) {
      await tx.update(accounts).set({ launchDiscountUsedAt: now.toISOString(), updatedAt: now.toISOString() })
        .where(eq(accounts.email, confirmedPayment.ownerEmail));
    }
    return "paid" as const;
  });
  if (justConfirmed) notifyAdminOfPayment(justConfirmed);
  return result;
}
