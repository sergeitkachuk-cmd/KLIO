// Single source of truth for the site's own public origin, used by the
// static metadata routes (robots.ts, sitemap.ts) and the root layout's
// metadataBase — none of these receive a Request to derive it from headers
// the way api/_lib/base-url.ts does for emailed links, so they read the same
// APP_BASE_URL env var directly. Keep the production value in sync with
// APP_BASE_URL on the host (see README-KLIO-RU.md) — a mismatch here doesn't
// break the site, it just makes robots.txt/sitemap.xml/OG tags point at the
// wrong domain.
const FALLBACK_BASE_URL = "http://localhost:3000";

export const SITE_BASE_URL = (process.env.APP_BASE_URL?.trim() || FALLBACK_BASE_URL).replace(/\/+$/, "");
