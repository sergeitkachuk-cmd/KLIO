"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

function safeReturnTo(): string {
  const target = new URLSearchParams(window.location.search).get("return_to");
  if (target && target.startsWith("/") && !target.startsWith("//")) return target;
  return "/workspace";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { user?: unknown }) => {
        if (!cancelled && payload.user) window.location.assign(safeReturnTo());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось войти.");
      window.location.assign(safeReturnTo());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <Link className="wordmark" href="/" aria-label="КЛИО — на главную">
          <span className="brand"><i>К</i><b>КЛИО</b><small>Цифровая редакция</small></span>
        </Link>
        <h1>Вход в кабинет</h1>
        <p className="auth-subtitle">Личный кабинет с генератором материалов, профилями брендов и архивом.</p>
        <form onSubmit={handleSubmit}>
          <label className="field">Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field">Пароль<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="auth-error">{error}</p>}
          <button className="button primary large" type="submit" disabled={busy}>{busy ? "Входим…" : "Войти"}</button>
        </form>
        <p className="auth-switch">Нет аккаунта? <Link href="/signup">Зарегистрироваться</Link></p>
      </div>
    </main>
  );
}
