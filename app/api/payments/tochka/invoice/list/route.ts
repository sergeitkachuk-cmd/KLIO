import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { invoices } from "../../../../../../db/schema";
import { getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../../../../_lib/workspace-account";

export async function GET() {
  try {
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const rows = await db.select({ id: invoices.id, planId: invoices.planId, billing: invoices.billing, amountKopecks: invoices.amountKopecks, buyerName: invoices.buyerName, paymentStatus: invoices.paymentStatus, paidAt: invoices.paidAt, closingDocumentId: invoices.closingDocumentId, createdAt: invoices.createdAt }).from(invoices).where(eq(invoices.ownerEmail, user.email)).orderBy(desc(invoices.createdAt)).limit(20);
    return Response.json({ invoices: rows });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось загрузить счета." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const body = await request.json().catch(() => ({}));
    const removable = and(
      eq(invoices.ownerEmail, user.email),
      isNull(invoices.paidAt),
      isNull(invoices.closingDocumentId),
      ne(invoices.paymentStatus, "payment_paid"),
    );
    const condition = typeof body.invoiceId === "string" && body.invoiceId.trim()
      ? and(removable, eq(invoices.id, body.invoiceId.trim()))
      : body.allUnpaid === true ? removable : null;
    if (!condition) return Response.json({ error: "Не указан счёт для удаления." }, { status: 400 });
    const deleted = await db.delete(invoices).where(condition).returning({ id: invoices.id });
    return Response.json({ deleted: deleted.length });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось удалить счета." }, { status: 500 });
  }
}
