"use client";

import { useEffect, useRef, useState } from "react";
import VkIcon from "./vk-icon";

// @vkid/sdk's UMD build, self-hosted (see public/vkid-sdk-2.6.1.js) rather
// than loaded from unpkg.com — see the file's own history for why. Bump the
// version in the filename (and re-download) deliberately, not by editing
// this constant alone.
const SDK_SCRIPT_URL = "/vkid-sdk-2.6.1.js";

// Minimal shape of the pieces of window.VKIDSDK this component actually
// calls. See auth/types.d.ts in the package for the full surface.
type VkIdSdk = {
  Config: { init: (config: Record<string, unknown>) => void };
  ConfigResponseMode: { Callback: unknown };
  ConfigSource: { LOWCODE: unknown };
  Auth: {
    // AuthResponse per the SDK's own types — code/device_id/state are the
    // fields exchangeCode needs; scope isn't a login() param, it comes from
    // the Config.init() call below instead.
    login: () => Promise<{ code?: string; device_id?: string }>;
    exchangeCode: (code: string, deviceId: string) => Promise<{ access_token: string }>;
  };
};

declare global {
  interface Window {
    VKIDSDK?: VkIdSdk;
  }
}

// This used to render VK ID's own OneTap widget. Switched away from it
// 2026-09-03: OneTap is built for frictionless one-tap sign-in and, per a
// still-open issue on VK's own SDK repo (VKCOM/vkid-web-sdk#23) describing
// the exact same symptom, can skip the consent screen entirely — which
// meant it never actually asked this app's visitors to share their email,
// no matter what scope Config.init() requested. VKID.Auth.login() is the
// same SDK's non-OneTap entry point (VK's "custom auth" flow, per
// AuthStatsFlowSource in the SDK's types — a real consent screen, not the
// streamlined widget), used here from a KLIO-styled button instead of VK's
// own widget UI. Untested against a real account as of this commit — if
// login() itself turns out not to resolve {code, device_id} the way its
// types promise, the fallback link below (unaffected either way) still
// works.
export default function VkSignIn({ returnTo }: { returnTo: string }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const vkidRef = useRef<VkIdSdk | null>(null);

  useEffect(() => {
    let cancelled = false;

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
        if (cancelled || !config.vkOAuthClientId || !config.vkRedirectUrl) return;

        await loadScript();
        if (cancelled) return;
        const vkid = window.VKIDSDK;
        if (!vkid) return;

        vkid.Config.init({
          app: Number(config.vkOAuthClientId),
          // Server-computed — see the comment in api/public-config/route.ts
          // for why window.location.origin isn't safe for a Cyrillic domain.
          redirectUrl: config.vkRedirectUrl,
          responseMode: vkid.ConfigResponseMode.Callback,
          source: vkid.ConfigSource.LOWCODE,
          scope: "email vkid.personal_info",
        });
        vkidRef.current = vkid;
        if (!cancelled) setReady(true);
      } catch (error) {
        console.error("VK sign-in init failed", error);
        if (!cancelled) setFailed(true);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleClick() {
    const vkid = vkidRef.current;
    if (!vkid) return;
    setBusy(true);
    try {
      const response = await vkid.Auth.login();
      if (!response?.code || !response?.device_id) throw new Error("VKID.Auth.login() returned no code/device_id");

      const tokenResult = await vkid.Auth.exchangeCode(response.code, response.device_id);
      const sessionResponse = await fetch("/api/auth/vk/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: tokenResult.access_token, returnTo }),
      });
      const payload = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok) throw new Error(payload?.error || "vk session failed");
      window.location.assign(payload.returnTo || returnTo);
    } catch (error) {
      console.error("VK sign-in failed", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // Same fallback for "SDK never became usable" and "the flow itself just
  // failed" — either way, the plain server-side redirect flow
  // (api/auth/vk/start/callback) is the one path here with no client-side
  // SDK dependency at all.
  if (failed || !ready) {
    return (
      <a className="button ghost" href={`/api/auth/vk/start?return_to=${encodeURIComponent(returnTo)}`}>
        <VkIcon />
        Войти через VK
      </a>
    );
  }

  return (
    <button type="button" className="button ghost" onClick={() => void handleClick()} disabled={busy}>
      <VkIcon />
      {busy ? "Входим…" : "Войти через VK"}
    </button>
  );
}
