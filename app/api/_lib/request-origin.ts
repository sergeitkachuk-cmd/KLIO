import { resolveBaseUrl } from "./base-url";

// Provider webhooks do not carry browser sessions and verify their own
// cryptographic signature. OAuth callbacks are GET and keep state checks.
const ORIGIN_EXEMPT_PATHS = new Set(["/api/payments/tochka/webhook"]);

export function hasUnsafeRequestOrigin(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return false;
  if (ORIGIN_EXEMPT_PATHS.has(new URL(request.url).pathname)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const incoming = new URL(origin).origin;
      if ((process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") && incoming === new URL(request.url).origin) return false;
      return incoming !== new URL(resolveBaseUrl(request)).origin;
    }
    catch { return true; }
  }
  // Non-browser API/cron clients may omit Origin; cross-site browser POSTs
  // must not bypass this check just by lacking that header.
  return request.headers.get("sec-fetch-site") === "cross-site";
}
