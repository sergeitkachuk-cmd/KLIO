import { discoverTochkaIds, tochkaFileRequest, TochkaConfigError } from "../../../../_lib/tochka";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const { customerCode } = await discoverTochkaIds();
    if (!customerCode) throw new TochkaConfigError("Не найден customerCode компании в Точке.");
    const response = await tochkaFileRequest(`/invoice/v1.0/bills/${encodeURIComponent(customerCode)}/${encodeURIComponent(documentId)}/file`);
    return new Response(response.body, { status: 200, headers: { "Content-Type": response.headers.get("content-type") || "application/pdf", "Content-Disposition": response.headers.get("content-disposition") || "attachment; filename=klio-invoice.pdf", "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось получить PDF счёта." }, { status: error instanceof TochkaConfigError ? 503 : 502 });
  }
}
