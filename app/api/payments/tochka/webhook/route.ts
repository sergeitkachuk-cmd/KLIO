import { eq } from "drizzle-orm";
import { payments } from "../../../../../db/schema";
import { getWorkspaceDb } from "../../../_lib/workspace-account";
import { verifyTochkaWebhook } from "../../../_lib/tochka";
import { readBoundedBody, RequestBodyError } from "../../../_lib/request-body";
import { confirmTochkaPayment } from "../../../_lib/confirm-tochka-payment";

function stringClaim(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numericAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

// The success path used to log nothing at all — after a real payment went
// unconfirmed with zero trace of the webhook ever arriving, every branch
// below now logs something, so "did Tochka even call us" is a log search
// away instead of a guess next time.
export async function POST(request: Request) {
  try {
    const raw = new TextDecoder().decode(await readBoundedBody(request, 65_536));
    const claims = await verifyTochkaWebhook(raw);
    if (!claims || claims.webhookType !== "acquiringInternetPayment") {
      console.error("Tochka webhook rejected: bad signature or unexpected type", claims?.webhookType ?? "(signature failed)");
      return new Response(null, { status: 400 });
    }
    if (claims.status !== "APPROVED") {
      console.log("Tochka webhook received, ignoring non-APPROVED status", claims.status, stringClaim(claims.paymentLinkId));
      return new Response(null, { status: 200 });
    }

    const paymentLinkId = stringClaim(claims.paymentLinkId);
    const operationId = stringClaim(claims.operationId);
    const amountKopecks = numericAmount(claims.amount);
    if (!paymentLinkId || !operationId || amountKopecks === null) {
      console.error("Tochka webhook missing required claims", { paymentLinkId, operationId, amount: claims.amount });
      return new Response(null, { status: 400 });
    }

    const db = await getWorkspaceDb();
    const state = await confirmTochkaPayment(db, paymentLinkId, operationId, { amountKopecks });
    const outcome = state === "paid" ? "confirmed" : state === "unknown" ? "unknown_payment" : "already_processed";
    console.log("Tochka webhook processed", outcome, paymentLinkId, operationId);
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof RequestBodyError) return new Response(null, { status: error.status });
    console.error("Tochka webhook failed", error instanceof Error ? error.message : "unknown error");
    return new Response(null, { status: 500 });
  }
}
