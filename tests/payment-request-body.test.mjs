import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Response, TextDecoder, Uint8Array, setTimeout, clearTimeout, ...globals });
  return exports;
}
for (const [path, method] of [["create", "POST"], ["invoice", "POST"], ["reconcile", "POST"], ["invoice/status", "POST"], ["invoice/list", "DELETE"]]) {
  test(`${path} rejects malformed and oversized bodies before DB operations`, async () => {
    const body = load("../app/api/_lib/request-body.ts");
    const route = load(`../app/api/payments/tochka/${path}/route.ts`, { require: name => {
      if (name.endsWith("/request-body")) return body;
      if (name.endsWith("/workspace-account")) return { workspaceIdentity: async () => ({ email: "test@example.invalid" }), getWorkspaceDb: async () => ({}), WorkspaceAccessError: class extends Error {} };
      return {};
    } });
    for (const [payload, expected] of [["null", 400], ["[]", 400], ["{", 400], ["x".repeat(4097), 413]]) {
      const response = await route[method](new Request("https://example.invalid", { method, body: payload }));
      assert.equal(response.status, expected);
    }
  });
}
