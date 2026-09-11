import { SITE_BASE_URL } from "../../site-url";

// Never let caller-controlled Host/Forwarded headers change email or OAuth
// destinations. Production has a configured/fixed public origin.
export function resolveBaseUrl(request: Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  if (process.env.NODE_ENV === "production") return SITE_BASE_URL;
  return new URL(request.url).origin;
}
