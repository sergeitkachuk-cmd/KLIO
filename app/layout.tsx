import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// Third typeface in the same side-by-side comparison (Inter, then
// Geist, now Manrope) - all requesting subsets:["latin","cyrillic"] so
// each one actually renders instead of silently falling through to a
// system font the way the original Geist config did. Manrope in
// particular was designed by Mikhail Sharanda, who's Belarusian, so its
// Cyrillic isn't a bolted-on afterthought subset the way it sometimes
// is on Western-designed typefaces. Same --font-sans variable name as
// the earlier swaps, so globals.css needs no changes.
const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "КЛИО — цифровая редакция для SEO и контента",
  description:
    "Создавайте SEO‑статьи, публикации и рекламные материалы с анализом ключей, голосом бренда и проверкой качества.",
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
      <body className={`${manrope.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
