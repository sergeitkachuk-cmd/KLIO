// Building public links from `request.url` is unreliable behind Render's
// proxy — the Next.js process sees its own internal bind address
// (0.0.0.0:10000), not the public hostname, so emailed verification links
// ended up pointing at http://0.0.0.0:10000/... Prefer an explicit
// APP_BASE_URL; fall back to standard forwarded-proto/-host headers, and
// only use request.url's origin as a last resort (correct for local dev).
export function resolveBaseUrl(request: Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}
