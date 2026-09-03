// Shared between cookie-consent.tsx (the banner that sets the choice) and
// yandex-metrica.tsx (the first, and so far only, consumer of it) — before
// this, the banner's choice was written to storage but nothing ever read it
// back. Kept as plain functions rather than a React context so the analytics
// script tag can be gated even outside a component tree if needed later.
export const CONSENT_KEY = "klio-cookie-consent";
export const CONSENT_CHANGE_EVENT = "klio-consent-change";
export const METRICA_GOAL_EVENT = "klio-metrica-goal";

export type MetricaGoal = "signup_completed" | "payment_completed";

export type Consent = "all" | "necessary";

// Cookie is the source of truth (works even if localStorage is blocked);
// localStorage is a fast client-side mirror of it. No stored choice yet
// (visitor hasn't answered the banner) means no analytics — consent must be
// opt-in, not assumed.
export function getConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )klio-cookie-consent=(all|necessary)/);
  return (match?.[1] as Consent | undefined) ?? null;
}

// Called by cookie-consent.tsx right after the visitor answers, so an
// already-mounted analytics component can start (or stay stopped) without
// requiring a page reload.
export function broadcastConsentChange() {
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}

export function trackMetricaGoal(goal: MetricaGoal) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MetricaGoal>(METRICA_GOAL_EVENT, { detail: goal }));
}
