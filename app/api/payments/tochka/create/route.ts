import { workspaceIdentity, WorkspaceAccessError } from "../../../_lib/workspace-account";
import { discoverTochkaIds, extractOperationId, extractPaymentUrl, tochkaRequest, TochkaConfigError } from "../../../_lib/tochka";
import { and, desc, eq, sql } from "drizzle-orm";
import { readBoundedJson, RequestBodyError } from "../../../_lib/request-body";
import { isPlanId, type PlanId } from "../../../../plans";
import { payments } from "../../../../../db/schema";
import { ensureAccount } from "../../../_lib/workspace-account";
import { getWorkspaceDb } from "../../../_lib/workspace-account";
import { isBillingPeriod, periodAmount, billingDescription, isPurchasablePlan, PLAN_PRICES, LAUNCH_DISCOUNT_BILLING, launchDiscountWindowOpen, applyLaunchDiscount } from "../../../../billing-pricing";
import { PAYMENT_LINK_TTL_MINUTES } from "../../../../payment-link";
import { resolveBaseUrl } from "../../../_lib/base-url";
import { isAdminEmail } from "../../../_lib/admin";
import { paymentErrorDetail } from "../../../_lib/payment-diagnostics";
import { confirmTochkaPayment } from "../../../_lib/confirm-tochka-payment";

function statusOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map(statusOf).find(Boolean);
  const record = value as Record<string, unknown>;
  if (typeof record.status === "string") return record.status;
  return Object.values(record).map(statusOf).find(Boolean);
}

export async function POST(request: Request) {
  let admin = false;
  let stage = "account";
  try {
    const user = await workspaceIdentity();
    admin = isAdminEmail(user.email);
    const input = await readBoundedJson(request, 4096);
    const account = await ensureAccount(user);
    const planId = input?.planId as PlanId;
    const mode = input?.mode === "card" ? "card" : "sbp";
    const billing = isBillingPeriod(input?.billing) ? input.billing : "monthly";
    if (!isPlanId(planId) || planId === "trial" || !isPurchasablePlan(planId)) return Response.json({ error: "Неизвестный тариф." }, { status: 400 });
    const price = PLAN_PRICES[planId];
    const baseAmount = periodAmount(price.monthly, price.yearly, billing);
    // Server-side only, never trusted from the client — see the launch
    // discount note in billing-pricing.ts. Eligibility is re-checked here
    // (not just displayed client-side) so a stale page or a direct API call
    // can't apply a discount that has already expired or been used.
    const discountApplied = billing === LAUNCH_DISCOUNT_BILLING && launchDiscountWindowOpen() && !account.launchDiscountUsedAt;
    const amount = discountApplied ? applyLaunchDiscount(baseAmount) : baseAmount;
    const db = await getWorkspaceDb();
    const baseUrl = new URL(resolveBaseUrl(request)).origin;
    const [existing] = await db.select().from(payments).where(and(
      eq(payments.ownerEmail, user.email),
      eq(payments.planId, planId),
      eq(payments.billing, billing),
      eq(payments.mode, mode),
      eq(payments.status, "pending"),
      sql`${payments.createdAt}::timestamptz >= CURRENT_TIMESTAMP - INTERVAL '3 days'`,
    )).orderBy(desc(payments.createdAt)).limit(1);
    if (existing) {
      if (existing.operationId) {
        stage = "existing-payment-check";
        const operation = await tochkaRequest<unknown>(`/acquiring/v1.0/payments/${encodeURIComponent(existing.operationId)}`);
        const status = statusOf(operation)?.toUpperCase();
        if (status === "APPROVED") {
          await confirmTochkaPayment(db, existing.id, existing.operationId);
          return Response.json({ paymentUrl: `${baseUrl}/account?payment=success&paymentLinkId=${encodeURIComponent(existing.id)}`, paymentLinkId: existing.id, planId, amount: existing.amountKopecks / 100, billing, mode, discountApplied: existing.discountApplied });
        }
        if (status === "EXPIRED") {
          await db.update(payments).set({ status: "expired", updatedAt: new Date().toISOString() }).where(and(eq(payments.id, existing.id), eq(payments.status, "pending")));
        } else if (existing.paymentUrl) {
          return Response.json({ paymentUrl: existing.paymentUrl, paymentLinkId: existing.id, planId, amount: existing.amountKopecks / 100, billing, mode, discountApplied: existing.discountApplied });
        } else {
          return Response.json({ error: "Предыдущая платёжная ссылка ещё обрабатывается. Обновите страницу через минуту." }, { status: 409 });
        }
      } else if (existing.paymentUrl) {
        return Response.json({ paymentUrl: existing.paymentUrl, paymentLinkId: existing.id, planId, amount: existing.amountKopecks / 100, billing, mode, discountApplied: existing.discountApplied });
      } else {
        return Response.json({ error: "Предыдущая платёжная ссылка ещё создаётся. Обновите страницу через минуту." }, { status: 409 });
      }
    }
    stage = "bank-settings";
    const { customerCode, merchantId } = await discoverTochkaIds();
    const paymentLinkId = `klio-${planId}-${crypto.randomUUID()}`.slice(0, 45);
    stage = "save-payment";
    await db.insert(payments).values({
      id: paymentLinkId,
      ownerEmail: user.email,
      planId,
      billing,
      mode,
      amountKopecks: amount * 100,
      discountApplied,
    });
    const purpose = `КЛИО: тариф «${price.name}», ${billingDescription(billing)}`;
    const operation = {
      amount,
      purpose,
      // Tochka fixes the order of mixed methods in its hosted page. Keep the
      // default checkout SBP-only so SBP is the first and primary action.
      paymentMode: mode === "card" ? ["card"] : ["sbp"],
      customerCode,
      ...(merchantId ? { merchantId } : {}),
      paymentLinkId,
      redirectUrl: `${baseUrl}/account?payment=success&paymentLinkId=${encodeURIComponent(paymentLinkId)}`,
      failRedirectUrl: `${baseUrl}/account?payment=failed`,
      callbackUrl: `${baseUrl}/api/payments/tochka/webhook`,
      ttl: PAYMENT_LINK_TTL_MINUTES,
      // Client + Items make this the fiscalized ("with-receipt") endpoint —
      // Tochka issues an actual 54-FZ cash receipt to Client.email once the
      // payment clears. The plain /acquiring/v1.0/payments endpoint used
      // before this never fiscalized anything: no chek was ever sent for a
      // quick SBP/card payment. taxSystemCode is deliberately omitted so
      // Tochka applies whatever tax regime is already configured on the
      // merchant account instead of us guessing it here.
      // A cabinet display name may be a nickname or a company name. It is not
      // reliable buyer identity data, so do not print it as a customer's name
      // in the fiscal receipt. The email is used to deliver that receipt.
      Client: { email: user.email },
      Items: [{
        name: purpose,
        amount,
        quantity: 1,
        vatType: "none",
        paymentMethod: "full_payment",
        paymentObject: "service",
        measure: "шт.",
      }],
    };
    stage = "bank-create-link";
    const response = await tochkaRequest<unknown>("/acquiring/v1.0/payments_with_receipt", {
      method: "POST",
      body: JSON.stringify({ Data: operation }),
    });
    stage = "bank-response";
    const paymentUrl = extractPaymentUrl(response);
    if (!paymentUrl) throw new Error("Точка не вернула ссылку на оплату.");
    const operationId = extractOperationId(response);
    stage = "save-operation";
    await db.update(payments).set({ paymentUrl, ...(operationId ? { operationId } : {}), updatedAt: new Date().toISOString() }).where(eq(payments.id, paymentLinkId));
    return Response.json({ paymentUrl, paymentLinkId, planId, amount, billing, mode, discountApplied });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError || error instanceof TochkaConfigError) return Response.json({ error: error.message }, { status: error instanceof WorkspaceAccessError ? error.status : 503 });
    const detail = paymentErrorDetail(error);
    console.error("Tochka payment link failed", { stage, detail });
    return Response.json({ error: admin ? `Не удалось создать платёжную ссылку. ${stage}: ${detail}` : "Не удалось создать платёжную ссылку. Попробуйте позже или обратитесь в поддержку.", code: "PAYMENT_LINK_FAILED" }, { status: 502 });
  }
}
