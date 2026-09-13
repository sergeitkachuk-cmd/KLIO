import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("status polling returns a completed result that won the timeout race", async () => {
  let reads = 0;
  const exports = {};
  const dependencies = {
    "../../_lib/async-jobs": {
      getAsyncJob: async () => ++reads === 1
        ? { id: "job", kind: "material_generation", status: "processing", updatedAt: new Date(0).toISOString() }
        : { id: "job", kind: "material_generation", status: "done", resultJson: JSON.stringify({ material: { body: "Saved result" } }) },
      failAsyncJob: async () => {},
    },
    "../../_lib/workspace-account": { workspaceIdentity: async () => ({ email: "test@example.invalid" }), WorkspaceAccessError: class extends Error {}, workspaceErrorResponse: () => { throw new Error("unexpected"); } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/generate/status/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Response, require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; } });
  const response = await exports.GET(new Request("https://example.invalid/api/generate/status?id=job"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "done");
  assert.equal(result.material.body, "Saved result");
});
