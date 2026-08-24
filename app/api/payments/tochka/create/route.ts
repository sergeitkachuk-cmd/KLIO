import { workspaceIdentity, WorkspaceAccessError } from "../../../_lib/workspace-account";
import { discoverTochkaIds, extractOperationId, extractPaymentUrl, tochkaRequest, TochkaConfigError } from "../../../_lib/tochka";
import { eq } from "drizzle-orm";
import { isPlanId, type PlanId } from "../../../../plans";
import { payments } from "../../../../../db/schema";
import { ensureAccount } from "../../../_lib/workspace-account";
import { getWorkspaceDb } from "../../../_lib/workspace-account";
import { isBillingPeriod, periodAmount, billingDescription } from "../../../../billing-pricing";

const PRICES: Record<Exclude<PlanId, "trial">, { monthly: number; yearly: number; name: string }> = {
  start: { monthly: 1190, yearly: 950, name: "Старт" },
  pro: { monthly: 2750, yearly: 2200, name: "Профи" },
  agency: { monthly: 6590, yearly: 5290, name: "Агентство" },
};

export async function POST(request: Request) {
  try {
    const user = await workspaceIdentity();
    await ensureAccount(user);
    const input = await request.json().catch(() => ({}));
    const planId = input?.planId as PlanId;
    const mode = input?.mode === "card" ? "card" : "sbp";
    const billing = isBillingPeriod(input?.billing) ? input.billing : "monthly";
    if (!isPlanId(planId) || planId === "trial" || !PRICES[planId]) return Response.json({ error: "Неизвестный тариф." }, { status: 400 });
    const price = PRICES[planId];
    const amount = periodAmount(price.monthly, price.yearly, billing);
    const { customerCode, merchantId } = await discoverTochkaIds();
    const baseUrl = process.env.APP_BASE_URL?.trim() || new URL(request.url).origin;
    const paymentLinkId = `klio-${planId}-${crypto.randomUUID()}`.slice(0, 45);
    const db = await getWorkspaceDb();
    await db.insert(payments).values({
      id: paymentLinkId,
      ownerEmail: user.email,
      planId,
      billing,
      mode,
      amountKopecks: amount * 100,
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
      ttl: 10080,
      // Client + Items make this the fiscalized ("with-receipt") endpoint —
      // Tochka issues an actual 54-FZ cash receipt to Client.email once the
      // payment clears. The plain /acquiring/v1.0/payments endpoint used
      // before this never fiscalized anything: no chek was ever sent for a
      // quick SBP/card payment. taxSystemCode is deliberately omitted so
      // Tochka applies whatever tax regime is already configured on the
      // merchant account instead of us guessing it here.
      Client: { name: user.displayName, email: user.email },
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
    const response = await tochkaRequest<unknown>("/acquiring/v1.0/payments_with_receipt", {
      method: "POST",
      body: JSON.stringify({ Data: operation }),
    });
    const paymentUrl = extractPaymentUrl(response);
    if (!paymentUrl) throw new Error("Точка не вернула ссылку на оплату.");
    const operationId = extractOperationId(response);
    if (operationId) await db.update(payments).set({ operationId, updatedAt: new Date().toISOString() }).where(eq(payments.id, paymentLinkId));
    return Response.json({ paymentUrl, paymentLinkId, planId, amount, billing, mode });
  } catch (error) {
    if (error instanceof WorkspaceAccessError || error instanceof TochkaConfigError) return Response.json({ error: error.message }, { status: error instanceof WorkspaceAccessError ? error.status : 503 });
    console.error("Tochka payment link failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось создать платёжную ссылку." }, { status: 502 });
  }
}
