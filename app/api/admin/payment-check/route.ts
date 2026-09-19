import { requireAdminUser } from "../../_lib/admin";
import { paymentErrorDetail } from "../../_lib/payment-diagnostics";
import { discoverTochkaIds } from "../../_lib/tochka";

export const runtime = "nodejs";

// Read-only bank check. Never creates a payment or reveals identifiers/tokens.
export async function GET() {
  if (!await requireAdminUser()) return Response.json({ error: "Недоступно." }, { status: 404 });
  try {
    const ids = await discoverTochkaIds();
    return Response.json({ bankReachable: true, customerFound: Boolean(ids.customerCode), merchantFound: Boolean(ids.merchantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ bankReachable: false, detail: paymentErrorDetail(error) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
