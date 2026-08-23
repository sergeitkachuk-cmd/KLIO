import { and, eq } from "drizzle-orm";
import { accounts, invoices } from "../../../../../../db/schema";
import { getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../../../../_lib/workspace-account";
import { discoverTochkaIds, tochkaRequest, TochkaConfigError } from "../../../../_lib/tochka";

function text(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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

export async function POST(request: Request) {
  try {
    const user = await workspaceIdentity();
    const input = await request.json().catch(() => ({}));
    const id = text(input?.invoiceId, 80);
    if (!id) return Response.json({ error: "Не указан счёт." }, { status: 400 });
    const db = await getWorkspaceDb();
    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.ownerEmail, user.email))).limit(1);
    if (!invoice) return Response.json({ error: "Счёт не найден." }, { status: 404 });
    const { customerCode } = await discoverTochkaIds();
    const accountId = text(process.env.TOCHKA_ACCOUNT_ID, 120);
    if (!customerCode || !accountId) throw new TochkaConfigError("Не настроены идентификаторы Точки для работы со счетами.");

    const statusResponse = await tochkaRequest<unknown>(`/invoice/v1.0/bills/${encodeURIComponent(customerCode)}/${encodeURIComponent(invoice.tochkaDocumentId)}/payment-status`);
    const paymentStatus = findString(statusResponse, "paymentStatus") || "payment_waiting";
    if (paymentStatus !== "payment_paid") {
      await db.update(invoices).set({ paymentStatus, updatedAt: new Date().toISOString() }).where(eq(invoices.id, invoice.id));
      return Response.json({ status: paymentStatus, invoiceId: invoice.id });
    }

    const activationNow = new Date().toISOString();
    await db.update(accounts).set({
      planId: invoice.planId,
      generationsUsed: 0,
      researchUsed: 0,
      editorActionsUsed: 0,
      generationMonth: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`,
      updatedAt: activationNow,
    }).where(eq(accounts.email, invoice.ownerEmail));

    if (invoice.closingDocumentId) {
      return Response.json({ status: paymentStatus, invoiceId: invoice.id, closingDocumentId: invoice.closingDocumentId, closingUrl: `/api/payments/tochka/closing/${encodeURIComponent(invoice.closingDocumentId)}` });
    }

    const now = new Date().toISOString();
    await db.update(accounts).set({
      planId: invoice.planId,
      generationsUsed: 0,
      researchUsed: 0,
      editorActionsUsed: 0,
      generationMonth: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`,
      updatedAt: now,
    }).where(eq(accounts.email, invoice.ownerEmail));

    const amount = invoice.amountKopecks / 100;
    const number = `UPD-${String(Date.now()).slice(-10)}`;
    const response = await tochkaRequest<unknown>("/invoice/v1.0/closing-documents", {
      method: "POST",
      body: JSON.stringify({ Data: {
        accountId, customerCode, documentId: invoice.tochkaDocumentId,
        SecondSide: {
          type: invoice.buyerType, taxCode: invoice.buyerInn,
          secondSideName: invoice.buyerName, legalAddress: invoice.buyerLegalAddress,
          ...(invoice.buyerKpp ? { kpp: invoice.buyerKpp } : {}),
        },
        Content: { Upd: {
          number, date: new Date().toISOString().slice(0, 10), function: "dop",
          totalAmount: amount, totalNds: 0,
          Positions: [{ positionName: "Доступ к сервису КЛИО", unitCode: "услуга.", ndsKind: "without_nds", price: amount, quantity: 1, totalAmount: amount, totalNds: 0 }],
        } },
      } }),
    });
    const closingDocumentId = findString(response, "documentId");
    if (!closingDocumentId) throw new Error("Точка не вернула идентификатор УПД.");
    let closingSentAt: string | null = null;
    try {
      await tochkaRequest(`/invoice/v1.0/closing-documents/${encodeURIComponent(customerCode)}/${encodeURIComponent(closingDocumentId)}/email`, {
        method: "POST", body: JSON.stringify({ Data: { email: invoice.buyerEmail } }),
      });
      closingSentAt = now;
    } catch (sendError) {
      // The PDF remains available even if the bank's email delivery is
      // temporarily unavailable; do not turn a successfully created UPD into
      // a failed reconciliation.
      console.error("Tochka closing document email failed", sendError instanceof Error ? sendError.message : "unknown error");
    }
    await db.update(invoices).set({ paymentStatus, paidAt: invoice.paidAt || now, closingDocumentId, closingStatus: "created", closingSentAt, updatedAt: now }).where(eq(invoices.id, invoice.id));
    return Response.json({ status: paymentStatus, invoiceId: invoice.id, closingDocumentId, closingSentAt, closingUrl: `/api/payments/tochka/closing/${encodeURIComponent(closingDocumentId)}` });
  } catch (error) {
    if (error instanceof WorkspaceAccessError || error instanceof TochkaConfigError) return Response.json({ error: error.message }, { status: error instanceof WorkspaceAccessError ? error.status : 503 });
    console.error("Tochka invoice status failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось проверить счёт." }, { status: 502 });
  }
}
