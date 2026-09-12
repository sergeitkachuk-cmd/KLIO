import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/workspace-save-queue.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });

test("manual save waits for the earlier autosave, including its response handling", async () => {
  const enqueue = exports.createWorkspaceSaveQueue();
  const events = [];
  let release;
  const first = enqueue(async () => {
    events.push("old-start");
    await new Promise(resolve => { release = resolve; });
    events.push("old-finish");
  });
  const second = enqueue(async () => { events.push("new-snapshot"); return true; });
  await Promise.resolve();
  assert.deepEqual(events, ["old-start"]);
  release();
  await first;
  assert.equal(await second, true);
  assert.deepEqual(events, ["old-start", "old-finish", "new-snapshot"]);
});

test("failed save does not prevent a subsequent retry", async () => {
  const enqueue = exports.createWorkspaceSaveQueue();
  await assert.rejects(enqueue(async () => { throw new Error("offline"); }), /offline/);
  assert.equal(await enqueue(async () => "saved"), "saved");
});
