import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Was Geist, loaded with subsets:["latin"] only - on a Russian-language
// site that's every visible character on the page. Geist has no
// Cyrillic glyphs at all, so the browser was silently falling through
// the rest of the --sans stack per character to whatever the visitor's
// OS happened to have (Segoe UI on Windows, San Francisco on macOS,
// etc.) instead of ever actually rendering Geist - inconsistent across
// visitors and not really "a font choice" so much as "no font choice".
// Inter renders the same everywhere, is one of the most widely used UI
// typefaces around (Vercel, Linear, GitHub...), and its cyrillic subset
// covers the letterforms people were seeing crowd together.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "КЛИО — цифровая редакция для SEO и контента",
  description:
    "Создавайте SEO‑статьи, публикации и рекламные материалы с анализом ключей, голосом бренда и проверкой качества.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${inter.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
