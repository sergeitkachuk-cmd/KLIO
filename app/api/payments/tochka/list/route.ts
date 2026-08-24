import { desc, eq } from "drizzle-orm";
import { payments } from "../../../../../db/schema";
import { getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../../../_lib/workspace-account";

export async function GET() {
  try {
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const rows = await db.select({ id: payments.id, planId: payments.planId, billing: payments.billing, amountKopecks: payments.amountKopecks, status: payments.status, operationId: payments.operationId, paidAt: payments.paidAt, createdAt: payments.createdAt })
      .from(payments).where(eq(payments.ownerEmail, user.email)).orderBy(desc(payments.createdAt)).limit(20);
    return Response.json({ payments: rows });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось загрузить историю оплат." }, { status: 500 });
  }
}
