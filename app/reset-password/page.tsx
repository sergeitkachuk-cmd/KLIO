"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Пароль должен быть не короче 8 символов.");
    if (password !== confirmation) return setError("Пароли не совпадают.");
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось изменить пароль.");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить пароль.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell"><div className="auth-card">
    <Link className="wordmark" href="/" aria-label="КЛИО — на главную"><span className="brand"><i>К</i><b>КЛИО<span aria-hidden="true">.</span></b><small>ЦИФРОВАЯ РЕДАКЦИЯ</small></span></Link>
    <h1>Новый пароль</h1>
    {done ? <><p className="auth-subtitle">Пароль изменён. Теперь можно войти в кабинет.</p><Link className="button primary large" href="/login">Войти</Link></> : <><p className="auth-subtitle">Ссылка действует один раз в течение часа.</p><form onSubmit={submit}><label className="field">Новый пароль<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="field">Повторите пароль<input type="password" required minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <p className="auth-error">{error}</p>}<button className="button primary large" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить новый пароль"}</button></form></>}
  </div></main>;
}
