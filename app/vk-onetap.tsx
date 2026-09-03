"use client";

import { useEffect, useRef, useState } from "react";

// @vkid/sdk's UMD build, served from our own /public instead of unpkg.com —
// injected at runtime, not installed as an npm dependency, for the same
// reason as Yandex Metrica's dynamic <script> (app/yandex-metrica.tsx):
// only needed on /login and /signup, only once this component mounts, not
// bundled into every page's JS. Originally pointed at unpkg.com directly;
// switched after a live report (2026-09-03) of Edge's Tracking Prevention
// blocking the SDK's own storage access specifically "for" that unpkg.com
// URL — plausible given unpkg is a large, widely-used CDN that legitimate
// trackers also ride on, landing it on some browsers' tracker-classification
// lists regardless of what any one script on it actually does. Self-hosting
// makes the SDK first-party (цифроваяредакция.рф serving its own script),
// which such lists have no reason to flag. File is the unmodified UMD
// bundle from https://unpkg.com/@vkid/sdk@2.6.1/dist-sdk/umd/index.js —
// bump the version in the filename (and re-download) deliberately, not by
// editing this constant alone.
const SDK_SCRIPT_URL = "/vkid-sdk-2.6.1.js";

// Minimal shape of the pieces of window.VKIDSDK this component actually
// calls — the real SDK surface is much larger. See auth/types.d.ts in the
// package for TokenResult/UserInfoResult if this ever needs more of it.
// .on() returns the same chainable widget so .on(ERROR, ...).on(LOGIN_SUCCESS, ...)
// (as used below) type-checks.
type VkIdWidget = {
  on: (event: unknown, handler: (payload?: { code?: string; device_id?: string }) => void) => VkIdWidget;
};

type VkIdSdk = {
  Config: { init: (config: Record<string, unknown>) => void };
  ConfigResponseMode: { Callback: unknown };
  ConfigSource: { LOWCODE: unknown };
  OneTap: new () => {
    render: (options: Record<string, unknown>) => VkIdWidget;
  };
  WidgetEvents: { ERROR: unknown };
  OneTapInternalEvents: { LOGIN_SUCCESS: unknown };
  Auth: {
    // Runs entirely in the browser via VK's own SDK — id_token is the only
    // field TokenResult has that this omits; access_token is all this
    // needs, since app/api/auth/vk/session/route.ts re-fetches user info
    // itself rather than trusting anything client-side.
    exchangeCode: (code: string, deviceId: string) => Promise<{ access_token: string }>;
  };
};

declare global {
  interface Window {
    VKIDSDK?: VkIdSdk;
  }
}

// Primary VK sign-in UI: VK's own OneTap widget (VK + the "3 в 1" alternate
// logins — Odnoklassniki, Mail — the site owner chose in VK ID's app
// wizard), styled to VK's own design rather than KLIO's custom buttons.
// Falls back to a plain text link through the classic redirect flow
// (api/auth/vk/start, api/auth/vk/callback) if the widget can't load at all
// — a blocked script (ad blocker, slow network), missing config, or an SDK
// error — so a visitor is never stuck with no way to use VK sign-in.
export default function VkOneTap({ returnTo }: { returnTo: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function completeSignIn(vkid: VkIdSdk, code: string, deviceId: string) {
      try {
        const tokenResult = await vkid.Auth.exchangeCode(code, deviceId);
        const response = await fetch("/api/auth/vk/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: tokenResult.access_token, returnTo }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "vk onetap session failed");
        window.location.assign(payload.returnTo || returnTo);
      } catch (error) {
        console.error("VK OneTap sign-in failed", error);
        if (!cancelled) setFailed(true);
      }
    }

    function loadScript(): Promise<void> {
      if (window.VKIDSDK) return Promise.resolve();
      const existing = document.querySelector(`script[src="${SDK_SCRIPT_URL}"]`);
      if (existing) {
        return new Promise((resolve, reject) => {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("vkid sdk script failed to load")));
        });
      }
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SDK_SCRIPT_URL;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("vkid sdk script failed to load"));
        document.head.appendChild(script);
      });
    }

    async function init() {
      try {
        const configResponse = await fetch("/api/public-config", { cache: "no-store" });
        const config = await configResponse.json().catch(() => ({})) as { vkOAuthClientId?: string | null; vkRedirectUrl?: string | null };
        if (cancelled || !config.vkOAuthClientId || !config.vkRedirectUrl) throw new Error("VK OAuth not configured");

        await loadScript();
        if (cancelled) return;
        const vkid = window.VKIDSDK;
        if (!vkid || !containerRef.current) throw new Error("VKIDSDK unavailable after load");

        vkid.Config.init({
          app: Number(config.vkOAuthClientId),
          // Server-computed (see api/public-config), not `${location.origin}/...` —
          // for цифроваяредакция.рф, window.location.origin can come back
          // Unicode or punycode depending on the visitor's browser and its
          // IDN display settings, and VK compares this byte-for-byte against
          // the punycode URL registered as the app's Redirect URL. A
          // mismatch here made sign-in silently fail for some visitors
          // while working for others, purely by browser luck.
          redirectUrl: config.vkRedirectUrl,
          responseMode: vkid.ConfigResponseMode.Callback,
          source: vkid.ConfigSource.LOWCODE,
          // The app wizard's generated snippet left this blank ("заполните
          // нужными доступами по необходимости") — left that way, VK
          // granted this specific sign-in no more than a bare user_id, so
          // oauth2/user_info came back with no email at all (confirmed
          // live 2026-09-03: a 422 from api/auth/vk/session, "VK не указан
          // email", even though the account plainly has one). The app-level
          // "Доступ к email" permission from setup only caps what a flow is
          // *allowed* to request — each flow still has to ask for it here.
          // Mirrors the scope already used by the plain-link fallback flow
          // (api/auth/vk/start).
          scope: "email vkid.personal_info",
        });

        // The widget doesn't stretch to fill its container on its own — it
        // renders at exactly the pixel width passed here (VK's own wizard
        // suggested a hardcoded 345, which only happens to be close to
        // .auth-card's own content width on desktop and would overflow a
        // narrow phone, where .auth-card's padding shrinks — see the
        // max-width:480px rule in globals.css). Measuring the container
        // itself is what actually keeps this matching the Яндекс button
        // above it, on any screen, without duplicating breakpoint numbers
        // here.
        const width = Math.round(containerRef.current.getBoundingClientRect().width) || 345;

        const oneTap = new vkid.OneTap();
        oneTap
          .render({
            container: containerRef.current,
            showAlternativeLogin: true,
            styles: { borderRadius: 12, width },
            oauthList: ["ok_ru", "mail_ru"],
          })
          .on(vkid.WidgetEvents.ERROR, () => {
            if (!cancelled) setFailed(true);
          })
          .on(vkid.OneTapInternalEvents.LOGIN_SUCCESS, (payload) => {
            if (payload?.code && payload?.device_id) void completeSignIn(vkid, payload.code, payload.device_id);
          });
      } catch (error) {
        console.error("VK OneTap init failed", error);
        if (!cancelled) setFailed(true);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [returnTo]);

  return (
    <div className="auth-vk-onetap">
      <div ref={containerRef} hidden={failed} />
      {failed && (
        <a className="button ghost" href={`/api/auth/vk/start?return_to=${encodeURIComponent(returnTo)}`}>
          Войти через VK по ссылке
        </a>
      )}
    </div>
  );
}
