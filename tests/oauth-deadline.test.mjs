import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

for (const provider of ["vk", "yandex"]) {
  test(`${provider} shares one deadline and never creates a session after provider failure`, async () => {
    let calls = 0;
    let deadlines = 0;
    const signal = {};
    const deps = {
      "next/headers": { cookies: async () => ({ get: () => ({ value: "saved" }), delete: () => {} }) },
      "next/server": { NextResponse: { redirect: url => new Response(null, { status: 307, headers: { location: url } }) } },
      "../../../_lib/base-url": { resolveBaseUrl: () => "https://example.invalid" },
      "../../../_lib/safe-return-path": { safeReturnPath: () => "/workspace" },
      "../../../_lib/workspace-account": { workspaceDatabaseAvailable: async () => true, ensureAccount: () => { throw new Error("must not create account"); } },
      "../../../../site-auth": { createSiteSession: () => { throw new Error("must not create session"); } },
      [`../../../_lib/${provider}-oauth`]: { [`${provider}OAuthConfigured`]: () => true },
    };
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../app/api/auth/${provider}/callback/route.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, URL, URLSearchParams, console: { error: () => {} },
      process: { env: { VK_OAUTH_CLIENT_ID: "test", YANDEX_OAUTH_CLIENT_ID: "test", YANDEX_OAUTH_CLIENT_SECRET: "test" } },
      require: name => deps[name] ?? {},
      AbortSignal: { timeout: ms => { deadlines++; assert.equal(ms, 20000); return signal; } },
      fetch: async (_url, options) => { calls++; assert.equal(options.signal, signal); if (calls === 1) return Response.json({ access_token: "test" }); throw new Error("provider timed out"); },
    });
    const response = await exports.GET(new Request("https://example.invalid?code=test&state=saved&device_id=test"));
    assert.equal(calls, 2);
    assert.equal(deadlines, 1);
    assert.match(response.headers.get("location"), /oauth_failed/);
    await exports.GET(new Request("https://example.invalid?code=test&state=wrong&device_id=test"));
    assert.equal(calls, 2);
  });
}
