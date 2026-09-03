"use client";

import { useEffect, useRef, useState } from "react";

// @vkid/sdk is loaded from unpkg at runtime, not installed as an npm
// dependency — same reasoning as Yandex Metrica's dynamic <script>
// injection (app/yandex-metrica.tsx): it's only needed on /login and
// /signup, and only once this component actually mounts, not bundled into
// every page's JS. Version pinned to the exact release verified against
// the SDK's own published TypeScript types (github.com/VKCOM/vkid-web-sdk)
// while building this — bump deliberately, not by dropping the pin.
const SDK_SCRIPT_URL = "https://unpkg.com/@vkid/sdk@2.6.1/dist-sdk/umd/index.js";

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
        const config = await configResponse.json().catch(() => ({})) as { vkOAuthClientId?: string | null };
        if (cancelled || !config.vkOAuthClientId) throw new Error("VK OAuth not configured");

        await loadScript();
        if (cancelled) return;
        const vkid = window.VKIDSDK;
        if (!vkid || !containerRef.current) throw new Error("VKIDSDK unavailable after load");

        vkid.Config.init({
          app: Number(config.vkOAuthClientId),
          redirectUrl: `${location.origin}/api/auth/vk/callback`,
          responseMode: vkid.ConfigResponseMode.Callback,
          source: vkid.ConfigSource.LOWCODE,
          scope: "",
        });

        const oneTap = new vkid.OneTap();
        oneTap
          .render({
            container: containerRef.current,
            showAlternativeLogin: true,
            styles: { borderRadius: 12, width: 345 },
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
