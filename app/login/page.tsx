"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

function safeReturnTo(): string {
  if (typeof window === "undefined") return "/workspace";
  const target = new URLSearchParams(window.location.search).get("return_to");
  if (target && target.startsWith("/") && !target.startsWith("//")) return target;
  return "/workspace";
}

function initialVerifyError(): string {
  if (typeof window === "undefined") return "";
  const verifyStatus = new URLSearchParams(window.location.search).get("verify");
  if (verifyStatus === "expired") return "Ссылка подтверждения устарела или уже использована. Войдите — мы предложим отправить новую.";
  if (verifyStatus === "failed") return "Не удалось подтвердить email. Попробуйте войти ещё раз.";
  return "";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialVerifyError);
  const [busy, setBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
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
    setNeedsVerification(false);
    setResendMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.code === "EMAIL_NOT_VERIFIED") setNeedsVerification(true);
        throw new Error(payload.error || "Не удалось войти.");
      }
      window.location.assign(safeReturnTo());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти.");
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
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));
      setResendMessage(payload.message || "Письмо отправлено повторно.");
    } catch {
      setResendMessage("Не удалось отправить письмо. Попробуйте позже.");
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <Link className="wordmark" href="/" aria-label="КЛИО — на главную">
          <span className="brand"><i>К</i><b>КЛИО<span aria-hidden="true">.</span></b><small>Цифровая редакция</small></span>
        </Link>
        <h1>Вход в кабинет</h1>
        <p className="auth-subtitle">Личный кабинет с генератором материалов, профилями брендов и архивом.</p>
        <form onSubmit={handleSubmit}>
          <label className="field">Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field">Пароль<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="auth-error">{error}</p>}
          {needsVerification && (
            <button className="button ghost" type="button" onClick={() => void handleResend()} disabled={resendBusy}>
              {resendBusy ? "Отправляем…" : "Отправить письмо подтверждения ещё раз"}
            </button>
          )}
          {resendMessage && <p className="auth-error" style={{ color: "#d3ffd8", background: "rgba(92,255,140,0.12)", borderColor: "rgba(118,255,118,0.35)" }}>{resendMessage}</p>}
          <button className="button primary large" type="submit" disabled={busy}>{busy ? "Входим…" : "Войти"}</button>
        </form>
        <p className="auth-switch">Нет аккаунта? <Link href={{ pathname: "/signup", query: { return_to: safeReturnTo() } }}>Зарегистрироваться</Link></p>
      </div>
    </main>
  );
}
