import { NextResponse } from "next/server";

// A route handler (unlike the root layout's static `metadata` export or a
// prerendered page) genuinely re-runs per request in the live container —
// see the matching comment in app/robots.ts for why that distinction
// matters on Timeweb: env vars set in its dashboard reach the running
// container, not the separate `npm run build` step that bakes static pages
// into the Docker image. YandexMetrica fetches this instead of reading
// YANDEX_METRICA_ID through a server-passed prop, so the counter ID is
// never at risk of being frozen from build time onto a static page.
export async function GET() {
  return NextResponse.json(
    {
      yandexMetricaId: process.env.YANDEX_METRICA_ID?.trim() || null,
      // Same reasoning as yandexMetricaId above — VkOneTap (app/vk-onetap.tsx)
      // fetches this instead of a build-time-frozen prop, since /login and
      // /signup are statically prerendered.
      vkOAuthClientId: process.env.VK_OAUTH_CLIENT_ID?.trim() || null,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
