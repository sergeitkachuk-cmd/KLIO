import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Block arbitrary framing while retaining the historical embed
        // origins. Framing never grants identity or replaces a site session.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://chatgpt.com https://chat.openai.com; object-src 'none'; base-uri 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Klio-UI-Release", value: "2026-09-30-admin-generation-accounting-v2" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
