import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack keeps some CSS chunk names stable between deployments. The
  // default immutable cache then makes an already-open mobile browser keep
  // an old stylesheet even when Render serves newer content at that URL.
  // Revalidate static assets instead: page updates now arrive without asking
  // a client to clear cache, while the browser can still use conditional
  // requests (ETag) when nothing changed.
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        // Applies site-wide. X-Frame-Options/frame-ancestors is deliberately
        // NOT set here: KLIO is embedded inside ChatGPT via the Apps SDK (see
        // oai-authenticated-user-* headers in chatgpt-auth.ts), which requires
        // the page to be frameable from chatgpt.com. Blocking framing outright
        // would break that integration — it needs a frame-ancestors allowlist
        // scoped to OpenAI's actual embed origin(s) instead, added deliberately
        // once that origin is confirmed, not as a blanket deny.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
