import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness(email, failProvider = false) {
  let calls = 0;
  class WorkspaceAccessError extends Error { constructor() { super("Login required"); this.status = 401; } }
  const row = { id: "invoice", tochkaDocumentId: "document", ownerEmail: "owner@example.invalid" };
  const deps = {
    "drizzle-orm": { eq: (key, value) => row => row[key] === value, and: (...conditions) => row => conditions.every(check => check(row)) },
    "../../../../../../db/schema": { invoices: { id: "id", tochkaDocumentId: "tochkaDocumentId", ownerEmail: "ownerEmail" } },
    "../../../../_lib/workspace-account": { WorkspaceAccessError, workspaceIdentity: async () => { if (!email) throw new WorkspaceAccessError(); return { email }; }, getWorkspaceDb: async () => ({ select: () => ({ from: () => ({ where: condition => ({ limit: async () => condition(row) ? [row] : [] }) }) }) }) },
    "../../../../_lib/tochka": { TochkaConfigError: class extends Error {}, discoverTochkaIds: async () => { calls++; return { customerCode: "test" }; }, tochkaFileRequest: async () => { if (failProvider) throw new Error("SECRET_PROVIDER_DETAILS"); return new Response("pdf"); } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/payments/tochka/invoice/[documentId]/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Response, require: name => deps[name] });
  return { get: () => exports.GET(new Request("https://example.invalid"), { params: Promise.resolve({ documentId: "document" }) }), calls: () => calls };
}
test("invoice download rejects anonymous and foreign owners before bank calls", async () => {
  for (const [email, status] of [[null, 401], ["other@example.invalid", 404]]) {
    const h = harness(email);
    assert.equal((await h.get()).status, status);
    assert.equal(h.calls(), 0);
  }
});
test("invoice owner can download; provider details never reach response", async () => {
  assert.equal((await harness("owner@example.invalid").get()).status, 200);
  const response = await harness("owner@example.invalid", true).get();
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /SECRET_PROVIDER_DETAILS/);
});
