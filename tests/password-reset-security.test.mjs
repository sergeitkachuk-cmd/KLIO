import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

function harness({ expired = false, failSessions = false, failInsert = false } = {}) {
  const token = "a".repeat(64);
  const schema = Object.fromEntries(["accounts", "passwordResets", "sessions"].map(name => [name, { name, id: "id", email: "email", expiresAt: "expiresAt" }]));
  let state = { reset: { id: crypto.createHash("sha256").update(token).digest("hex"), email: "test@example.invalid", expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)).toISOString() }, password: "old", sessions: 2 };
  let queue = Promise.resolve();
  const matches = (row, predicate) => predicate(row);
  const db = { transaction(fn) {
    const operation = queue.then(async () => {
      const before = structuredClone(state);
      const tx = {
        execute: async () => {},
        insert: () => ({ values: async value => { if (failInsert) throw new Error("reset storage failed"); state.reset = value; } }),
        delete(table) { return { where(predicate) {
          const execute = () => {
            if (table === schema.sessions) {
              if (failSessions) throw new Error("session storage failed");
              state.sessions = 0;
              return [];
            }
            const record = state.reset;
            if (!record || !matches(record, predicate)) return [];
            state.reset = null;
            return [record];
          };
          return { returning: async () => execute(), then: (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject) };
        } }; },
        update() { return { set(value) { return { where() { return { returning: async () => { state.password = value.passwordHash; return [{ email: "test@example.invalid" }]; } }; } }; } }; },
      };
      try { return await fn(tx); } catch (error) { state = before; throw error; }
    });
    queue = operation.catch(() => {});
    return operation;
  } };
  const deps = { "node:crypto": crypto, "drizzle-orm": {
    sql: () => null,
    eq: (key, value) => row => row[key] === value,
    gt: (key, value) => row => row[key] > value,
    and: (...predicates) => row => predicates.every(predicate => predicate(row)),
  }, "../../../db": { getDb: () => db }, "../../../db/schema": schema };
  const exports = {};
  const source = readFileSync(new URL("../app/api/_lib/password-reset.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => { if (!(name in deps)) throw new Error(name); return deps[name]; } });
  return { consume: password => exports.consumePasswordReset(token, password), issue: () => exports.createPasswordReset("test@example.invalid"), state: () => state };
}

test("reset token has one winner and revokes existing sessions", async () => {
  const h = harness();
  assert.deepEqual(await Promise.all([h.consume("first"), h.consume("second")]), [true, false]);
  assert.equal(h.state().password, "first");
  assert.equal(h.state().sessions, 0);
});

test("expired token cannot change password or revoke sessions", async () => {
  const h = harness({ expired: true });
  assert.equal(await h.consume("new"), false);
  assert.equal(h.state().password, "old");
  assert.equal(h.state().sessions, 2);
});

test("session revocation failure rolls back password and token consumption", async () => {
  const h = harness({ failSessions: true });
  await assert.rejects(h.consume("new"), /session storage failed/);
  assert.equal(h.state().password, "old");
  assert.ok(h.state().reset);
  assert.equal(h.state().sessions, 2);
});

test("failed replacement preserves the previous password reset link", async () => {
  const h = harness({ failInsert: true });
  const previous = h.state().reset.id;
  await assert.rejects(h.issue(), /reset storage failed/);
  assert.equal(h.state().reset.id, previous);
});

test("concurrent reset issuance retains only the latest link", async () => {
  const h = harness();
  const [first, second] = await Promise.all([h.issue(), h.issue()]);
  assert.notEqual(first, second);
  assert.equal(h.state().reset.id, crypto.createHash("sha256").update(second).digest("hex"));
  assert.equal(h.state().sessions, 2);
});
