import type { MetadataRoute } from "next";
import { SITE_BASE_URL } from "./site-url";

// See the matching comment in robots.ts: without this, the URLs below get
// baked in at Docker-image build time (wrong APP_BASE_URL there on Timeweb)
// instead of read fresh from the running container's actual env.
export const dynamic = "force-dynamic";

// Only the public, indexable marketing pages — /workspace, /account, /admin
// and /reset-password are excluded here the same way they're disallowed in
// robots.ts (auth-gated or token-carrying, not content).
const PUBLIC_ROUTES: Array<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/examples", priority: 0.8 },
  { path: "/signup", priority: 0.8 },
  { path: "/login", priority: 0.5 },
  { path: "/legal/offer", priority: 0.3 },
  { path: "/legal/privacy", priority: 0.3 },
  { path: "/legal/refunds", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map(({ path, priority }) => ({
    url: `${SITE_BASE_URL}${path}`,
    priority,
  }));
}
