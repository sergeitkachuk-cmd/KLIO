"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CONSENT_KEY, broadcastConsentChange } from "./analytics-consent";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Deferred a tick purely to satisfy react-hooks/set-state-in-effect
    // (see the matching note on the theme-sync effect in
    // textora-experience.tsx) rather than reaching for eslint-disable.
    queueMicrotask(() => {
      try {
        const saved = window.localStorage.getItem(CONSENT_KEY);
        if (!saved) setVisible(true);
      } catch {
        setVisible(true);
      }
    });
  }, []);

  function choose(value: "all" | "necessary") {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // The service remains usable when storage is blocked by the browser.
    }
    document.cookie = `${CONSENT_KEY}=${value}; Max-Age=31536000; Path=/; SameSite=Lax`;
    broadcastConsentChange();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside className="cookie-consent" role="dialog" aria-label="Настройки cookies">
      <div className="cookie-consent-copy">
        <strong>Настройки cookies</strong>
        <p>КЛИО использует необходимые cookies для входа, безопасности и работы личного кабинета. Подробнее — в <Link href="/legal/privacy">политике обработки данных</Link>.</p>
      </div>
      <div className="cookie-consent-actions">
        <button type="button" className="cookie-consent-secondary" onClick={() => choose("necessary")}>Только необходимые</button>
        <button type="button" className="cookie-consent-primary" onClick={() => choose("all")}>Принять</button>
      </div>
    </aside>
  );
}
