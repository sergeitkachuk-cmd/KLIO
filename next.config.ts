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
    ];
  },
};

export default nextConfig;
