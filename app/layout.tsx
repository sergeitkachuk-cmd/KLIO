import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Trying Geist back on for a side-by-side look, this time actually
// requesting the cyrillic subset. The original bug wasn't "Geist can't
// do Cyrillic" - Geist added real Cyrillic support (better cyrillic
// design landed in the vercel/geist-font project, google/fonts lists
// cyrillic + cyrillic-ext subsets for it) - the bug was that this file
// only ever asked next/font for subsets:["latin"], so the browser fell
// through to a system font for every visible character on this
// Russian-language site regardless of which typeface was named here.
// Same --font-sans variable as the Inter swap, so no changes needed on
// the globals.css side.
const geist = Geist({
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
      <body className={`${geist.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
