"use client";

// App Router error boundary for the whole site. Without this file, an
// uncaught render error anywhere in the tree (most exposure: the single
// large client component behind "/") falls through to Next's generic
// unstyled error screen — jarring for a visitor who just clicked a paid ad.
// `reset()` re-renders the segment in place rather than a full reload.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
      <h1 style={{ margin: 0, fontSize: "clamp(28px, 5vw, 44px)" }}>Что-то пошло не так</h1>
      <p style={{ margin: 0, maxWidth: 440, color: "var(--muted)", fontSize: 16, lineHeight: 1.5 }}>
        Страница не смогла загрузиться. Попробуйте ещё раз — если ошибка повторится, напишите нам.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          marginTop: 8,
          padding: "12px 24px",
          border: 0,
          borderRadius: 999,
          background: "var(--acid)",
          color: "#08131e",
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        Попробовать снова
      </button>
    </main>
  );
}
