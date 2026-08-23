import { randomUUID } from "node:crypto";
import { invoices } from "../../../../../db/schema";
import { ensureAccount, getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../../../_lib/workspace-account";
import { tochkaCustomerCode, tochkaRequest, TochkaConfigError } from "../../../_lib/tochka";
import { isPlanId, type PlanId } from "../../../../plans";
import { isBillingPeriod, periodAmount, billingDescription } from "../../../../billing-pricing";

const PRICES: Record<Exclude<PlanId, "trial">, { monthly: number; yearly: number; name: string }> = {
  start: { monthly: 1190, yearly: 950, name: "Старт" },
  pro: { monthly: 2750, yearly: 2200, name: "Профи" },
  agency: { monthly: 6590, yearly: 5290, name: "Агентство" },
};

function text(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dateInDays(days: number) {
  const date = new Date(Date.now() + days * 86400000);
  return date.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    const user = await workspaceIdentity();
    await ensureAccount(user);
    const input = await request.json().catch(() => ({}));
    const planId = input?.planId as PlanId;
    const billing = isBillingPeriod(input?.billing) ? input.billing : "monthly";
    if (!isPlanId(planId) || planId === "trial" || !PRICES[planId]) return Response.json({ error: "Неизвестный тариф." }, { status: 400 });

    const buyer = input?.buyer && typeof input.buyer === "object" ? input.buyer : {};
    const type = buyer.type === "ip" ? "ip" : "company";
    const name = text(buyer.name);
    const inn = text(buyer.inn, 20);
    const legalAddress = text(buyer.legalAddress);
    const email = text(buyer.email, 180);
    const kpp = text(buyer.kpp, 20);
    const accountId = text(process.env.TOCHKA_ACCOUNT_ID, 120);
    if (!accountId) throw new TochkaConfigError("Для оплаты по счёту добавьте переменную TOCHKA_ACCOUNT_ID — расчётный счёт ООО в Точке.");
    if (!name || !inn || !legalAddress || !email) return Response.json({ error: "Заполните название, ИНН, юридический адрес и e-mail." }, { status: 400 });
    if (type === "company" && !kpp) return Response.json({ error: "Для организации укажите КПП." }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Проверьте e-mail покупателя." }, { status: 400 });

    const customerCode = tochkaCustomerCode();
    if (!customerCode) throw new TochkaConfigError("Для счёта не найден customerCode компании в Точке.");
    const price = PRICES[planId];
    const amount = periodAmount(price.monthly, price.yearly, billing);
    const documentNumber = String(Date.now()).slice(-10);
    const response = await tochkaRequest<unknown>("/invoice/v1.0/bills", {
      method: "POST",
      body: JSON.stringify({
        Data: {
          customerCode,
          accountId,
          SecondSide: {
            type,
            taxCode: inn,
            secondSideName: name,
            ...(kpp ? { kpp } : {}),
            legalAddress,
          },
          Content: {
            Invoice: {
              number: documentNumber,
              date: new Date().toISOString().slice(0, 10),
              paymentExpiryDate: dateInDays(7),
              comment: `Тариф «${price.name}», период: ${billingDescription(billing)}. Клиент: ${user.email}`,
              totalAmount: amount,
              totalNds: 0,
              Positions: [{
                positionName: "KLIO service access",
                unitCode: "\u0443\u0441\u043b\u0443\u0433\u0430.",
                ndsKind: "without_nds",
                quantity: 1,
                price: amount,
                totalAmount: amount,
                totalNds: 0,
              }],
            },
          },
        },
      }),
    });
    const documentId = findString(response, "documentId");
    if (!documentId) throw new Error("Точка не вернула идентификатор счёта.");
    const db = await getWorkspaceDb();
    await db.insert(invoices).values({
      id: randomUUID(), ownerEmail: user.email, planId, billing,
      amountKopecks: amount * 100, tochkaDocumentId: documentId,
      buyerType: type, buyerName: name, buyerInn: inn, buyerKpp: kpp || null,
      buyerLegalAddress: legalAddress, buyerEmail: email,
    });
    return Response.json({ documentId, invoiceUrl: `/api/payments/tochka/invoice/${encodeURIComponent(documentId)}`, amount, planId, billing });
  } catch (error) {
    if (error instanceof WorkspaceAccessError || error instanceof TochkaConfigError) return Response.json({ error: error.message }, { status: error instanceof WorkspaceAccessError ? error.status : 503 });
    console.error("Tochka invoice failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось создать счёт." }, { status: 502 });
  }
}

function findString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map((item) => findString(item, key)).find(Boolean);
  for (const [name, item] of Object.entries(value)) {
    if (name === key && typeof item === "string") return item;
    const nested = findString(item, key);
    if (nested) return nested;
  }
  return undefined;
}
