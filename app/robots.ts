import type { MetadataRoute } from "next";
import { SITE_BASE_URL } from "./site-url";

// Without this, Next prerenders robots.txt once at `next build` time and
// serves that same static file forever after — baking in whatever
// APP_BASE_URL happened to be set during the Docker image build, which on
// Timeweb is not the same env the running container gets (that one only
// reaches the container at runtime, confirmed 2026-09-03: the OAuth flow,
// a genuinely per-request route, saw the real domain; this file, prerendered
// at build time, still showed localhost). Forcing this dynamic makes it
// re-read SITE_BASE_URL on every request against the live container's env
// instead, at the cost of one extra render per crawl (negligible for a file
// this small and this rarely fetched).
export const dynamic = "force-dynamic";

// Public marketing pages stay crawlable; everything behind a login (workspace,
// account, admin) or carrying a one-time token in the query string
// (reset-password) must not be indexed or followed by bots.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/workspace", "/account", "/admin", "/reset-password"],
      },
    ],
    sitemap: `${SITE_BASE_URL}/sitemap.xml`,
  };
}
