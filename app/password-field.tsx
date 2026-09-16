"use client";

import { useId, useState, type ReactNode } from "react";

// Shared by login/signup/reset-password — the same show/hide toggle
// everywhere a password is typed (site owner: "без него неудобно").
export function PasswordField({ label, value, onChange, autoComplete, minLength, hint }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  hint?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      {label}
      <div className="password-field-row">
        <input id={id} type={visible ? "text" : "password"} required minLength={minLength} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} />
        <button type="button" className="password-field-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Скрыть пароль" : "Показать пароль"} aria-pressed={visible}>
          {visible ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>
      {hint}
    </label>
  );
}
