import Link from "next/link";

// Next's App Router renders this for any unmatched route (a mistyped ad
// landing URL, an old bookmarked link, etc.) instead of falling through to
// the framework's unstyled default — same brand chrome as the rest of the
// site, reusing the existing --paper/--ink/--acid/--sans tokens from
// globals.css rather than introducing new ones.
export default function NotFound() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        minHeight: "100svh",
        padding: "24px",
        textAlign: "center",
        background: "var(--paper)",
        color: "var(--ink)",
        fontFamily: "var(--sans)",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--muted)" }}>КЛИО</span>
      <h1 style={{ margin: 0, fontSize: "clamp(28px, 5vw, 44px)" }}>Страница не найдена</h1>
      <p style={{ margin: 0, maxWidth: 440, color: "var(--muted)", fontSize: 16, lineHeight: 1.5 }}>
        Такой страницы больше нет или адрес указан неверно. Проверьте ссылку или вернитесь на главную.
      </p>
      <Link
        href="/"
        style={{
          marginTop: 8,
          padding: "12px 24px",
          borderRadius: 999,
          background: "var(--acid)",
          color: "#08131e",
          fontWeight: 800,
          textDecoration: "none",
        }}
      >
        На главную
      </Link>
    </main>
  );
}
