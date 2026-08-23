import { desc, eq } from "drizzle-orm";
import { invoices } from "../../../../../../db/schema";
import { getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../../../../_lib/workspace-account";

export async function GET() {
  try {
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const rows = await db.select({ id: invoices.id, planId: invoices.planId, billing: invoices.billing, amountKopecks: invoices.amountKopecks, buyerName: invoices.buyerName, paymentStatus: invoices.paymentStatus, closingDocumentId: invoices.closingDocumentId, createdAt: invoices.createdAt }).from(invoices).where(eq(invoices.ownerEmail, user.email)).orderBy(desc(invoices.createdAt)).limit(20);
    return Response.json({ invoices: rows });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось загрузить счета." }, { status: 500 });
  }
}
