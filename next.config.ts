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
        // Block arbitrary framing while retaining the historical embed
        // origins. Framing never grants identity or replaces a site session.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://chatgpt.com https://chat.openai.com; object-src 'none'; base-uri 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
