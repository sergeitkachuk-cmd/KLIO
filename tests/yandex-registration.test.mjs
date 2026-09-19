import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers/dialogue-harness.mjs";

test("Yandex creates a verified session and retains the intended checkout page on success and failure", async () => {
  let providerCalls = 0, sessions = 0, accountsCreated = 0;
  const returnTo = "/account?planId=start&billing=quarterly";
  let missingEmail = false;
  const dependencies = {
    "next/headers": { cookies: async () => ({ get: name => ({ value: name.endsWith("state") ? "test-state" : returnTo }), delete: () => {} }) },
    "next/server": { NextResponse: { redirect: url => new Response(null, { status: 307, headers: { location: url } }) } },
    "drizzle-orm": { eq: () => null },
    "../../../../../db/schema": { accounts: { email: "email" } },
    "../../../_lib/base-url": { resolveBaseUrl: () => "https://example.invalid" },
    "../../../_lib/safe-return-path": load("app/api/_lib/safe-return-path.ts"),
    "../../../_lib/yandex-oauth": { yandexOAuthConfigured: () => true, YANDEX_TOKEN_URL: "https://oauth.yandex.ru/token", YANDEX_USER_INFO_URL: "https://login.yandex.ru/info" },
    "../../../_lib/workspace-account": { workspaceDatabaseAvailable: async () => true, ensureAccount: async (user, method) => { accountsCreated++; assert.equal(user.email, "test@example.invalid"); assert.equal(method, "yandex"); return { emailVerified: false }; }, getWorkspaceDb: async () => ({ update: () => ({ set: fields => { assert.equal(fields.emailVerified, true); return { where: async () => {} }; } }) }) },
    "../../../../site-auth": { createSiteSession: async email => { assert.equal(email, "test@example.invalid"); sessions++; } },
  };
  const route = load("app/api/auth/yandex/callback/route.ts", dependencies, {
    URLSearchParams,
    process: { env: { YANDEX_OAUTH_CLIENT_ID: "fixture", YANDEX_OAUTH_CLIENT_SECRET: "fixture-secret" } },
    fetch: async url => { providerCalls++; return Response.json(url.includes("/token") ? { access_token: "test" } : { id: "test-id", default_email: missingEmail ? "" : "Test@Example.Invalid", display_name: "Тест" }); },
  });
  const success = await route.GET(new Request("https://example.invalid/api/auth/yandex/callback?code=test&state=test-state"));
  assert.equal(success.headers.get("location"), `https://example.invalid${returnTo}`);
  assert.equal(sessions, 1);
  const rejected = await route.GET(new Request("https://example.invalid/api/auth/yandex/callback?error=access_denied&state=test-state"));
  const target = new URL(rejected.headers.get("location"));
  assert.equal(target.searchParams.get("return_to"), returnTo);
  assert.equal(target.searchParams.get("error"), "oauth_failed");
  assert.equal(providerCalls, 2);
  missingEmail = true;
  const noEmail = await route.GET(new Request("https://example.invalid/api/auth/yandex/callback?code=test&state=test-state"));
  assert.equal(new URL(noEmail.headers.get("location")).searchParams.get("error"), "oauth_no_email");
  assert.equal(accountsCreated, 1);
  assert.equal(sessions, 1);
});
