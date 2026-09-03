import type { MetadataRoute } from "next";
import { SITE_BASE_URL } from "./site-url";

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
