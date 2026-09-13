import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

for (const [route, kind] of [["generate", "material_generation"], ["content-plan", "content_plan"], ["adapt", "adapt_text"]]) {
for (const settledStatus of ["done", "processing"]) {
test(`${route} polling preserves ${settledStatus} after a timeout race`, async () => {
  let reads = 0;
  const exports = {};
  const dependencies = {
    "../../_lib/async-jobs": {
      getAsyncJob: async () => ++reads === 1
        ? { id: "job", kind, status: "processing", updatedAt: new Date(0).toISOString() }
        : { id: "job", kind, status: settledStatus, resultJson: JSON.stringify({ material: { body: "Saved result" } }) },
      failAsyncJob: async (id, message, expectedUpdatedAt) => {
        assert.equal(id, "job");
        assert.equal(expectedUpdatedAt, new Date(0).toISOString());
      },
    },
    "../../_lib/workspace-account": { workspaceIdentity: async () => ({ email: "test@example.invalid" }), WorkspaceAccessError: class extends Error {}, workspaceErrorResponse: () => { throw new Error("unexpected"); } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../app/api/${route}/status/route.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Response, require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; } });
  const response = await exports.GET(new Request("https://example.invalid/api/generate/status?id=job"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, settledStatus);
  if (settledStatus === "done") assert.equal(result.material.body, "Saved result");
});
}
}
