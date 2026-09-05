import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import "../public/workspace-refresh-20260816-2.css";
import CookieConsent from "./cookie-consent";
import YandexMetrica from "./yandex-metrica";
import { SITE_BASE_URL } from "./site-url";

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

// Without metadataBase, Next resolves any relative OG/Twitter image URL
// against the request origin at render time instead of a fixed canonical
// domain — fine for the page itself, but link-preview crawlers (Telegram,
// VK, ad-network scrapers) that fetch the page directly need one absolute,
// stable origin. See ./site-url.ts for where this comes from.
const TITLE = "КЛИО — цифровая редакция для SEO и контента";
const DESCRIPTION =
  "КЛИО — цифровая редакция для брендов: помогает находить темы, готовить SEO‑статьи, посты и рекламу, учитывать голос бренда и планировать публикации.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_BASE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  icons: {
    icon: "/favicon-klio.png",
    shortcut: "/favicon-klio.png",
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "КЛИО",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Sets data-theme on <html> before React hydrates/paints anything, from
// the same localStorage key textora-experience.tsx's theme toggle reads
// and writes (see setTheme there). Without this, the page would always
// render server-side with no theme attribute (dark, the CSS default),
// then flash to light a moment after hydration for anyone who'd
// actually picked light - this blocking inline script runs before first
// paint so there's nothing to flash. Wrapped in try/catch because
// localStorage can throw in some privacy-mode/embedded contexts, and a
// dead script here must never block the rest of the page from loading.
const themeBootstrapScript = `try {
  var t = localStorage.getItem("klio-theme");
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
} catch (e) {}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${manrope.variable} antialiased`}>
        {children}
        <CookieConsent />
        <YandexMetrica />
      </body>
    </html>
  );
}
