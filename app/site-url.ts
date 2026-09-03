// Single source of truth for the site's own public origin, used by the
// metadata routes (robots.ts, sitemap.ts) and the root layout's
// metadataBase — none of these receive a Request to derive it from headers
// the way api/_lib/base-url.ts does for emailed links, so they read the same
// APP_BASE_URL env var directly.
//
// The production fallback isn't a placeholder — it's a real safety net.
// layout.tsx's metadataBase feeds the home page's OG/Twitter tags, and that
// page is statically prerendered: its HTML (and metadataBase inside it) is
// fixed once at `npm run build` time, inside the Docker image build stage.
// On Timeweb that step runs separately from the container APP_BASE_URL
// actually reaches — confirmed 2026-09-03, when the build baked in
// localhost even though the running container had the right value the
// whole time (see the OAuth flow, a genuinely per-request route, which saw
// it correctly). robots.ts/sitemap.ts sidestep this with
// `export const dynamic = "force-dynamic"`, but a static page's own
// metadata can't opt out the same way without making the whole site
// dynamic — so if APP_BASE_URL is ever missing at build time again, better
// to fall back to the real domain than to a dead localhost link in
// production. Update this if the domain ever changes.
const PRODUCTION_FALLBACK_BASE_URL = "https://цифроваяредакция.рф";
const DEV_FALLBACK_BASE_URL = "http://localhost:3000";

const FALLBACK_BASE_URL = process.env.NODE_ENV === "production" ? PRODUCTION_FALLBACK_BASE_URL : DEV_FALLBACK_BASE_URL;

export const SITE_BASE_URL = (process.env.APP_BASE_URL?.trim() || FALLBACK_BASE_URL).replace(/\/+$/, "");
