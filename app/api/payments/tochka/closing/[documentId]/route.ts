import { and, eq } from "drizzle-orm";
import { invoices } from "../../../../../../db/schema";
import { getWorkspaceDb, WorkspaceAccessError, workspaceIdentity } from "../../../../_lib/workspace-account";
import { discoverTochkaIds, tochkaFileRequest, TochkaConfigError } from "../../../../_lib/tochka";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const [owned] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.closingDocumentId, documentId), eq(invoices.ownerEmail, user.email))).limit(1);
    if (!owned) return Response.json({ error: "РЈРџР” РЅРµ РЅР°Р№РґРµРЅ." }, { status: 404 });
    const { customerCode } = await discoverTochkaIds();
    if (!customerCode) throw new TochkaConfigError("Для скачивания УПД не найден customerCode Точки.");
    const response = await tochkaFileRequest(`/invoice/v1.0/closing-documents/${encodeURIComponent(customerCode)}/${encodeURIComponent(documentId)}/file`);
    return new Response(response.body, { status: 200, headers: { "Content-Type": response.headers.get("content-type") || "application/pdf", "Content-Disposition": response.headers.get("content-disposition") || "attachment; filename=klio-upd.pdf", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError || error instanceof TochkaConfigError) return Response.json({ error: error.message }, { status: error instanceof WorkspaceAccessError ? error.status : 503 });
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось скачать УПД." }, { status: 502 });
  }
}
