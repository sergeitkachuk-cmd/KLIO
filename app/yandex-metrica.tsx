"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_CHANGE_EVENT, METRICA_GOAL_EVENT, getConsent, type MetricaGoal } from "./analytics-consent";

type YmFunction = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };

declare global {
  interface Window {
    ym?: YmFunction;
  }
}

// Loads the official Yandex Metrica tag, but only once the visitor has
// actively chosen "Принять" in the cookie banner (see cookie-consent.tsx) —
// not on first paint, and not for "Только необходимые". Renders nothing
// itself; it only ever injects the vendor's own <script>.
//
// The counter ID comes from GET /api/public-config, not a server-passed
// prop — this component is mounted from the root layout, which is shared by
// statically prerendered pages (the home page among them). A prop read from
// process.env.YANDEX_METRICA_ID there would freeze at whatever value
// existed when `next build` ran, which on Timeweb is a separate step from
// the running container and doesn't see its env vars (confirmed
// 2026-09-03: the counter was silently absent in production because of
// exactly this). The API route is a genuine per-request handler, so it
// always reflects the live container's actual env.
//
// init options are the counter's own "SPA" snippet (metrika.yandex.ru,
// counter 112265063) verbatim, plus ssr:true — every route here is actually
// server-rendered by Next on first load, not a client-only SPA shell, and
// that option tells Metrica so it reads document.referrer/location.href
// correctly instead of guessing from the tag's own load time.
//
// Goal tracking (signup completed, payment completed) isn't wired up yet —
// once needed, call window.ym?.(counterId, "reachGoal", "goal-name") from
// those flows. ecommerce:"dataLayer" is likewise declared but inert until
// something actually pushes purchase events onto window.dataLayer.
export default function YandexMetrica() {
  const [counterId, setCounterId] = useState<string | null>(null);
  const pathname = usePathname();
  // Tracks the URL the counter last reported a hit for, so the route-change
  // effect below can (a) supply the correct referrer and (b) skip the very
  // first URL, which the init call already reports itself.
  const lastTrackedUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public-config", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { yandexMetricaId?: string | null }) => {
        if (!cancelled && payload.yandexMetricaId) setCounterId(payload.yandexMetricaId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!counterId) return;
    let injected = false;

    function loadIfConsented() {
      if (injected || getConsent() !== "all") return;
      // Belt-and-braces dedupe against the official snippet's own check —
      // guards a second copy of this effect (React Strict Mode's dev
      // double-invoke, a hot-reload remount) from inserting tag.js twice.
      const scriptUrl = `https://mc.yandex.ru/metrika/tag.js?id=${counterId}`;
      if (Array.from(document.scripts).some((script) => script.src === scriptUrl)) return;
      injected = true;

      // Mirrors Yandex's own inline snippet: a queueing stub that becomes
      // the real tracker once tag.js finishes loading and replaces it.
      const ym: YmFunction = (...args) => {
        (ym.a ||= []).push(args);
      };
      ym.l = Date.now();
      window.ym = ym;

      const script = document.createElement("script");
      script.async = true;
      script.src = scriptUrl;
      document.head.appendChild(script);

      lastTrackedUrl.current = location.href;
      ym(Number(counterId), "init", {
        ssr: true,
        webvisor: true,
        clickmap: true,
        ecommerce: "dataLayer",
        accurateTrackBounce: true,
        trackLinks: true,
        referrer: document.referrer,
        url: location.href,
      });
    }

    loadIfConsented();
    window.addEventListener(CONSENT_CHANGE_EVENT, loadIfConsented);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, loadIfConsented);
  }, [counterId]);

  // Client-side navigation (next/link between "/", "/signup", "/legal/...")
  // never reloads the page, so the tag's own initial hit only ever sees
  // whichever URL was current when consent was granted. Fire an explicit
  // "hit" on every later route change, with the previous URL as referrer —
  // same shape Metrica's own SPA guidance describes.
  useEffect(() => {
    if (!counterId || !window.ym || lastTrackedUrl.current === null) return;
    const url = `${location.origin}${pathname}${location.search}`;
    if (lastTrackedUrl.current === url) return;
    const referrer = lastTrackedUrl.current;
    lastTrackedUrl.current = url;
    window.ym(Number(counterId), "hit", url, { referrer });
  }, [pathname, counterId]);

  useEffect(() => {
    if (!counterId) return;
    const trackGoal = (event: Event) => {
      if (getConsent() !== "all") return;
      const goal = (event as CustomEvent<MetricaGoal>).detail;
      if (goal === "signup_completed" || goal === "payment_completed") {
        window.ym?.(Number(counterId), "reachGoal", goal);
      }
    };
    window.addEventListener(METRICA_GOAL_EVENT, trackGoal);
    return () => window.removeEventListener(METRICA_GOAL_EVENT, trackGoal);
  }, [counterId]);

  return null;
}
