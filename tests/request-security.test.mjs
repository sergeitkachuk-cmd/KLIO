import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}, env = { NODE_ENV: "production" }) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL, TextDecoder, setTimeout, clearTimeout, process: { env },
    require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; },
  });
  return exports;
}

test("public email and OAuth links ignore forged forwarded host in production", () => {
  const loaded = load("app/api/_lib/base-url.ts", { "../../site-url": { SITE_BASE_URL: "https://klio.example" } });
  const request = new Request("http://internal:3000/api/auth/forgot-password", { headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http" } });
  assert.equal(loaded.resolveBaseUrl(request), "https://klio.example");
});

test("cross-site mutations are blocked without breaking same-origin requests and signed webhooks", () => {
  const loaded = load("app/api/_lib/request-origin.ts", { "./base-url": { resolveBaseUrl: () => "https://klio.example" } });
  const request = (headers, path = "/api/workspace", method = "POST") => new Request(`https://klio.example${path}`, { method, headers });
  assert.equal(loaded.hasUnsafeRequestOrigin(request({ origin: "https://attacker.example" })), true);
  assert.equal(loaded.hasUnsafeRequestOrigin(request({ origin: "null" })), true);
  assert.equal(loaded.hasUnsafeRequestOrigin(request({ "sec-fetch-site": "cross-site" })), true);
  assert.equal(loaded.hasUnsafeRequestOrigin(request({ origin: "https://klio.example" })), false);
  assert.equal(loaded.hasUnsafeRequestOrigin(request({}, "/api/cron/publish-due")), false);
  assert.equal(loaded.hasUnsafeRequestOrigin(request({ origin: "https://bank.example" }, "/api/payments/tochka/webhook")), false);
  assert.equal(loaded.hasUnsafeRequestOrigin(request({ origin: "https://oauth.example" }, "/api/auth/vk/callback", "GET")), false);
});

test("return paths cannot redirect to an external host using slash or backslash variants", () => {
  const { safeReturnPath } = load("app/api/_lib/safe-return-path.ts");
  for (const path of ["//attacker.example", "/\\attacker.example", "https://attacker.example", "/login", "/signup"]) assert.equal(safeReturnPath(path), "/workspace");
  assert.equal(safeReturnPath("/workspace#history"), "/workspace#history");
});

test("request bodies are bounded even without Content-Length", async () => {
  const { readBoundedBody } = load("app/api/_lib/request-body.ts");
  await assert.rejects(readBoundedBody(new Request("https://klio.example", { method: "POST", body: "123456789" }), 4), error => error.status === 413);
  const bytes = await readBoundedBody(new Request("https://klio.example", { method: "POST", body: "1234" }), 4);
  assert.equal(new TextDecoder().decode(bytes), "1234");
});

test("bounded JSON rejects non-object, invalid and oversized authentication payloads", async () => {
  const { readBoundedJson } = load("app/api/_lib/request-body.ts");
  const request = body => new Request("https://klio.example", { method: "POST", body });
  for (const body of ["null", "[]", "42", "{invalid"]) await assert.rejects(readBoundedJson(request(body)), error => error.status === 400);
  await assert.rejects(readBoundedJson(request('{"password":"' + "x".repeat(100) + '"}'), 32), error => error.status === 413);
  assert.equal((await readBoundedJson(request('{"email":"test@example.invalid"}'))).email, "test@example.invalid");
});

test("stalled upload is cancelled within its request deadline", async () => {
  let cancelled = false;
  const { readBoundedBody } = load("app/api/_lib/request-body.ts");
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(readBoundedBody(new Request("https://klio.example", { method: "POST", body: stream, duplex: "half" }), 4, 10), error => error.status === 408);
  assert.equal(cancelled, true);
});

test("image signature rejects HTML and SVG regardless of the declared MIME", () => {
  const { imageContentType } = load("app/api/_lib/image-type.ts");
  assert.equal(imageContentType(new TextEncoder().encode("<html>pretending to be PNG</html>")), null);
  assert.equal(imageContentType(new TextEncoder().encode("<svg onload='alert(1)'>")), null);
  assert.equal(imageContentType(Uint8Array.from([137,80,78,71,13,10,26,10])), "image/png");
  assert.equal(imageContentType(Uint8Array.from([255,216,255,224])), "image/jpeg");
});
