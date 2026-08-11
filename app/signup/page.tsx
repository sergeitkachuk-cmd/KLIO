"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

function safeReturnTo(): string {
  const target = new URLSearchParams(window.location.search).get("return_to");
  if (target && target.startsWith("/") && !target.startsWith("//")) return target;
  return "/workspace";
}

export default function SignupPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

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
    if (password.length < 8) {
      setError("Пароль должен быть не короче 8 символов.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось зарегистрироваться.");
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось зарегистрироваться.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setResendBusy(true);
    setResendMessage("");
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sentTo }),
      });
      const payload = await response.json().catch(() => ({}));
      setResendMessage(payload.message || "Письмо отправлено повторно.");
    } catch {
      setResendMessage("Не удалось отправить письмо. Попробуйте позже.");
    } finally {
      setResendBusy(false);
    }
  }

  if (sentTo) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <Link className="wordmark" href="/" aria-label="КЛИО — на главную">
            <span className="brand"><i>К</i><b>КЛИО<span aria-hidden="true">.</span></b><small>Цифровая редакция</small></span>
          </Link>
          <h1>Проверьте почту</h1>
          <p className="auth-subtitle">Мы отправили письмо со ссылкой подтверждения на <b>{sentTo}</b>. Перейдите по ней, чтобы открыть кабинет — ссылка действует 24 часа.</p>
          {resendMessage && <p className="auth-error" style={{ color: "#d3ffd8", background: "rgba(92,255,140,0.12)", borderColor: "rgba(118,255,118,0.35)" }}>{resendMessage}</p>}
          <button className="button ghost large" type="button" onClick={() => void handleResend()} disabled={resendBusy}>{resendBusy ? "Отправляем…" : "Отправить письмо ещё раз"}</button>
          <p className="auth-switch">Уже подтвердили? <Link href="/login">Войти</Link></p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <Link className="wordmark" href="/" aria-label="КЛИО — на главную">
          <span className="brand"><i>К</i><b>КЛИО<span aria-hidden="true">.</span></b><small>Цифровая редакция</small></span>
        </Link>
        <h1>Личный кабинет</h1>
        <p className="auth-subtitle">Регистрация занимает минуту — дальше доступны генератор, профиль бренда и архив материалов.</p>
        <form onSubmit={handleSubmit}>
          <label className="field">Имя<input required autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="field">Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field">Пароль<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Не короче 8 символов</small></label>
          {error && <p className="auth-error">{error}</p>}
          <button className="button primary large" type="submit" disabled={busy}>{busy ? "Создаём…" : "Создать кабинет"}</button>
        </form>
        <p className="auth-switch">Уже есть аккаунт? <Link href="/login">Войти</Link></p>
      </div>
    </main>
  );
}
