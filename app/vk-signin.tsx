"use client";

import { useEffect, useRef, useState } from "react";

const SDK_SCRIPT_URL = "/vkid-sdk-2.6.1.js";

type VkIdWidget = {
  on: (event: unknown, handler: (payload?: { code?: string; device_id?: string }) => void) => VkIdWidget;
};

type VkIdSdk = {
  Config: { init: (config: Record<string, unknown>) => void };
  ConfigResponseMode: { Callback: unknown };
  ConfigSource: { LOWCODE: unknown };
  OneTap: new () => { render: (options: Record<string, unknown>) => VkIdWidget };
  WidgetEvents: { ERROR: unknown };
  OneTapInternalEvents: { LOGIN_SUCCESS: unknown };
  Auth: { exchangeCode: (code: string, deviceId: string) => Promise<{ access_token: string }> };
};

declare global {
  interface Window {
    VKIDSDK?: VkIdSdk;
  }
}

function redirectToFullVkOAuth(returnTo: string) {
  window.location.assign(`/api/auth/vk/start?return_to=${encodeURIComponent(returnTo)}`);
}

// VK ID's branded widget presents VK plus the configured alternative
// providers (OK and Mail.ru). A full OAuth redirect remains the recovery
// path when VK ID does not return an email for this streamlined flow.
export default function VkSignIn({ returnTo }: { returnTo: string }) {
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
        const payload = await response.json().catch(() => ({})) as { returnTo?: string; code?: string; error?: string };

        // OneTap may reuse an old VK consent session without returning the
        // email scope. Send only this case through the full consent flow.
        if (response.status === 422 && payload.code === "VK_EMAIL_REQUIRED") {
          redirectToFullVkOAuth(returnTo);
          return;
        }
        if (!response.ok) throw new Error(payload.error || "vk onetap session failed");
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
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("VK ID SDK failed to load")), { once: true });
        });
      }
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SDK_SCRIPT_URL;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("VK ID SDK failed to load"));
        document.head.appendChild(script);
      });
    }

    async function init() {
      try {
        const configResponse = await fetch("/api/public-config", { cache: "no-store" });
        const config = await configResponse.json().catch(() => ({})) as { vkOAuthClientId?: string | null; vkRedirectUrl?: string | null };
        if (!config.vkOAuthClientId || !config.vkRedirectUrl) throw new Error("VK OAuth is not configured");

        await loadScript();
        const vkid = window.VKIDSDK;
        const container = containerRef.current;
        if (cancelled || !vkid || !container) return;

        vkid.Config.init({
          app: Number(config.vkOAuthClientId),
          redirectUrl: config.vkRedirectUrl,
          responseMode: vkid.ConfigResponseMode.Callback,
          source: vkid.ConfigSource.LOWCODE,
          scope: "email vkid.personal_info",
        });

        const width = Math.round(container.getBoundingClientRect().width) || 345;
        new vkid.OneTap()
          .render({
            container,
            showAlternativeLogin: true,
            styles: { borderRadius: 12, width },
            oauthList: ["ok_ru", "mail_ru"],
          })
          .on(vkid.WidgetEvents.ERROR, () => { if (!cancelled) setFailed(true); })
          .on(vkid.OneTapInternalEvents.LOGIN_SUCCESS, (payload) => {
            if (payload?.code && payload.device_id) void completeSignIn(vkid, payload.code, payload.device_id);
          });
      } catch (error) {
        console.error("VK OneTap init failed", error);
        if (!cancelled) setFailed(true);
      }
    }

    void init();
    return () => { cancelled = true; };
  }, [returnTo]);

  return (
    <div className="auth-vk-onetap">
      <div ref={containerRef} hidden={failed} />
      {failed && (
        <button type="button" className="button ghost" onClick={() => redirectToFullVkOAuth(returnTo)}>
          Войти через VK
        </button>
      )}
    </div>
  );
}
