import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness() {
  let now = 1000;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/_lib/rate-limit.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date: { now: () => now } });
  return { limited: exports.isRateLimited, advance: milliseconds => { now += milliseconds; } };
}

test("rate limit resets exactly at its window boundary", () => {
  const h = harness();
  assert.equal(h.limited("caller", 1, 100), false);
  assert.equal(h.limited("caller", 1, 100), true);
  h.advance(100);
  assert.equal(h.limited("caller", 1, 100), false);
});

test("key flooding cannot evict active limits; expired capacity recovers", () => {
  const h = harness();
  assert.equal(h.limited("protected", 1, 1000), false);
  for (let index = 0; index < 4999; index++) assert.equal(h.limited(`key-${index}`, 1, 100), false);
  assert.equal(h.limited("overflow", 1, 100), true);
  assert.equal(h.limited("protected", 1, 1000), true);
  h.advance(100);
  assert.equal(h.limited("overflow", 1, 100), false);
  assert.equal(h.limited("protected", 1, 1000), true);
});

test("saturation preserves unused allowance for already tracked callers", () => {
  const h = harness();
  h.limited("existing", 2, 1000);
  for (let index = 0; index < 4999; index++) h.limited(`key-${index}`, 1, 1000);
  assert.equal(h.limited("new", 1, 1000), true);
  assert.equal(h.limited("existing", 2, 1000), false);
  assert.equal(h.limited("existing", 2, 1000), true);
});
