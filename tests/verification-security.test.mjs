import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness({ expiresAt = new Date(Date.now() + 60000).toISOString(), failUpdate = false, failInsert = false } = {}) {
  const token = "a".repeat(64);
  let state = { token: { id: crypto.createHash("sha256").update(token).digest("hex"), email: "test@example.invalid", expiresAt }, verified: false };
  let queue = Promise.resolve();
  const schema = { accounts: { email: "email" }, emailVerifications: { id: "id", email: "email" } };
  const db = { transaction(fn) {
    const operation = queue.then(async () => {
      const before = structuredClone(state);
      const tx = {
        execute: async () => {},
        delete: () => ({ where: predicate => {
          const execute = () => { if (!state.token || !predicate(state.token)) return []; const row = state.token; state.token = null; return [row]; };
          return { returning: async () => execute(), then: (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject) };
        } }),
        insert: () => ({ values: async row => { if (failInsert) throw new Error("insert failed"); state.token = row; } }),
        update: () => ({ set: () => ({ where: () => ({ returning: async () => { if (failUpdate) throw new Error("update failed"); state.verified = true; return [{ email: "test@example.invalid" }]; } }) }) }),
      };
      try { return await fn(tx); } catch (error) { state = before; throw error; }
    });
    queue = operation.catch(() => {});
    return operation;
  } };
  const deps = { "node:crypto": crypto, "drizzle-orm": { eq: (key, value) => row => row[key] === value, sql: () => null }, "../../../db": { getDb: () => db }, "../../../db/schema": schema };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/_lib/verification.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => deps[name] });
  return { consume: (value = token) => exports.consumeEmailVerification(value), issue: () => exports.createEmailVerification("test@example.invalid"), state: () => state };
}

test("verification has one winner for simultaneous consumers", async () => {
  const h = harness();
  assert.deepEqual(await Promise.all([h.consume(), h.consume()]), ["test@example.invalid", null]);
});
test("verification update failure preserves the link", async () => {
  const h = harness({ failUpdate: true });
  await assert.rejects(h.consume(), /update failed/);
  assert.ok(h.state().token);
  assert.equal(h.state().verified, false);
});
test("expired, corrupt and malformed verification tokens fail closed", async () => {
  for (const expiresAt of ["invalid", new Date(0).toISOString()]) {
    const h = harness({ expiresAt });
    assert.equal(await h.consume(), null);
    assert.equal(h.state().verified, false);
  }
  assert.equal(await harness().consume("invalid"), null);
});
test("failed verification replacement retains the previous link", async () => {
  const h = harness({ failInsert: true });
  const previous = h.state().token.id;
  await assert.rejects(h.issue(), /insert failed/);
  assert.equal(h.state().token.id, previous);
});
test("concurrent verification issuance keeps only the latest link", async () => {
  const h = harness();
  const [first, second] = await Promise.all([h.issue(), h.issue()]);
  assert.equal(await h.consume(first), null);
  assert.equal(await h.consume(second), "test@example.invalid");
});
