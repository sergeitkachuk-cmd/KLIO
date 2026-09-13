import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, globals) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, ...globals });
  return exports;
}
test("VK login rejects oversized payloads and bounds provider waiting", async () => {
  const body = load("../app/api/_lib/request-body.ts", { TextDecoder, Uint8Array, setTimeout, clearTimeout });
  let calls = 0;
  const deps = {
    "../../../_lib/request-body": body,
    "../../../_lib/rate-limit": { clientIp: () => "test", isRateLimited: () => false },
    "../../../_lib/workspace-account": { workspaceDatabaseAvailable: async () => true, workspaceErrorResponse: error => { throw error; } },
    "../../../_lib/vk-oauth": { vkOAuthConfigured: () => true, VK_USER_INFO_URL: "https://example.invalid" },
    "../../../_lib/safe-return-path": { safeReturnPath: () => "/workspace" },
  };
  const route = load("../app/api/auth/vk/session/route.ts", {
    require: name => deps[name] ?? {}, Response, URLSearchParams, Error,
    process: { env: { VK_OAUTH_CLIENT_ID: "test" } },
    AbortSignal: { timeout: ms => { assert.equal(ms, 15000); return "bounded"; } },
    fetch: async (_url, options) => { calls++; assert.equal(options.signal, "bounded"); const error = new Error("timeout"); error.name = "TimeoutError"; throw error; },
  });
  const oversized = await route.POST(new Request("https://example.invalid", { method: "POST", body: "x".repeat(17000) }));
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
  const timedOut = await route.POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ accessToken: "test" }) }));
  assert.equal(timedOut.status, 504);
  assert.equal(calls, 1);
});
