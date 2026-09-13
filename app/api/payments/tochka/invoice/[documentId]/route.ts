import { discoverTochkaIds, tochkaFileRequest, TochkaConfigError } from "../../../../_lib/tochka";
import { and, eq } from "drizzle-orm";
import { invoices } from "../../../../../../db/schema";
import { getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../../../../_lib/workspace-account";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const [owned] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.tochkaDocumentId, documentId), eq(invoices.ownerEmail, user.email))).limit(1);
    if (!owned) return Response.json({ error: "Счёт не найден." }, { status: 404 });
    const { customerCode } = await discoverTochkaIds();
    if (!customerCode) throw new TochkaConfigError("Не найден customerCode компании в Точке.");
    const response = await tochkaFileRequest(`/invoice/v1.0/bills/${encodeURIComponent(customerCode)}/${encodeURIComponent(documentId)}/file`);
    return new Response(response.body, { status: 200, headers: { "Content-Type": response.headers.get("content-type") || "application/pdf", "Content-Disposition": response.headers.get("content-disposition") || "attachment; filename=klio-invoice.pdf", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось получить PDF счёта." }, { status: error instanceof TochkaConfigError ? 503 : 502 });
  }
}
