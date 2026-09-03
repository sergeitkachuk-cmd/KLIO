import { NextResponse } from "next/server";
import { resolveBaseUrl } from "../_lib/base-url";

// A route handler (unlike the root layout's static `metadata` export or a
// prerendered page) genuinely re-runs per request in the live container —
// see the matching comment in app/robots.ts for why that distinction
// matters on Timeweb: env vars set in its dashboard reach the running
// container, not the separate `npm run build` step that bakes static pages
// into the Docker image. YandexMetrica fetches this instead of reading
// YANDEX_METRICA_ID through a server-passed prop, so the counter ID is
// never at risk of being frozen from build time onto a static page.
export async function GET(request: Request) {
  return NextResponse.json(
    {
      yandexMetricaId: process.env.YANDEX_METRICA_ID?.trim() || null,
      // Same reasoning as yandexMetricaId above — VkOneTap (app/vk-onetap.tsx)
      // fetches this instead of a build-time-frozen prop, since /login and
      // /signup are statically prerendered.
      vkOAuthClientId: process.env.VK_OAUTH_CLIENT_ID?.trim() || null,
      // VkOneTap also needs this to build its redirectUrl for
      // VKID.Config.init. It must byte-for-byte match the punycode form
      // registered as VK's "Доверенный Redirect URL", but browsers'
      // window.location.origin for a Cyrillic domain (цифроваяредакция.рф)
      // is inconsistent — which form it shows depends on the browser and
      // its IDN display policy, not something this app controls. Found
      // 2026-09-03: VK ID silently failed to complete sign-in for a visitor
      // whose browser showed the Unicode form there. resolveBaseUrl(request)
      // is the same server-side computation api/auth/vk/start and every
      // other OAuth route already use — do it here too instead of trusting
      // the browser to derive it.
      vkRedirectUrl: new URL("/api/auth/vk/callback", resolveBaseUrl(request)).href,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
