import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

function harness({ failInsert = false, ownedBrand = true, jobStatus = "processing", failReceipt = false } = {}) {
  const now = new Date();
  let used = 0;
  const schema = { accounts: {}, brands: {}, generations: {}, asyncJobs: {} };
  let status = jobStatus;
  let archived = 0;
  const account = () => ({ email: "test@example.invalid", displayName: "Tester", planId: "trial", generationMonth: now.toISOString().slice(0, 7), createdAt: now.toISOString(), generationsUsed: used });
  const query = rows => ({ limit: async () => rows, then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) });
  const db = {
    select: projection => ({ from: table => ({ where: () => query(table === schema.accounts ? [account()] : projection?.count ? [{ count: 1 }] : ownedBrand ? [{ id: "brand" }] : []) }) }),
    update: table => ({ set: values => ({ where: () => ({
      returning: async () => { if (table === schema.asyncJobs) return status === "processing" ? [{ id: "job" }] : []; used++; return [account()]; },
      then: (resolve, reject) => Promise.resolve().then(() => { if (failReceipt) throw new Error("receipt failed"); status = values.status; }).then(resolve, reject),
    }) }) }),
    insert: () => ({ values: value => ({ returning: async () => { if (failInsert) throw new Error("disk full"); archived++; return [value]; } }) }),
    transaction: async fn => { const before = { used, archived, status }; try { return await fn(db); } catch (error) { ({ used, archived, status } = before); throw error; } },
  };
  const noop = () => null;
  const deps = {
    "drizzle-orm": { and: noop, eq: noop, isNull: noop, lt: noop, sql: noop },
    "../../../db/schema": schema, "../../../db": { getDb: () => db },
    "../../identity": { getCurrentUser: async () => ({ email: "test@example.invalid", displayName: "Tester" }) },
    "../../plans": { planRule: () => ({ id: "trial", generationLimit: 10 }), planExpiryState: noop },
    "./subscription": { nextQuotaPeriodEnd: noop },
  };
  const source = readFileSync(new URL("../app/api/_lib/workspace-account.ts", import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, crypto: { randomUUID }, process: { env: { NODE_ENV: "production", DATABASE_URL: "configured" } },
    require: name => { if (!(name in deps)) throw new Error(name); return deps[name]; },
  });
  return { record: (job = false) => exports.recordGeneration({ brandId: "brand", title: "Title", body: "Body" }, job ? { id: "job", result: { material: "result" } } : undefined), used: () => used, archived: () => archived, status: () => status };
}

test("failed material persistence rolls back quota debit", async () => {
  const h = harness({ failInsert: true });
  await assert.rejects(h.record(), /disk full/);
  assert.equal(h.used(), 0);
});

test("unowned brand is rejected without spending quota", async () => {
  const h = harness({ ownedBrand: false });
  await assert.rejects(h.record(), error => error.status === 404);
  assert.equal(h.used(), 0);
});

test("saved material and debit succeed together", async () => {
  const h = harness();
  assert.equal((await h.record()).archive.brandId, "brand");
  assert.equal(h.used(), 1);
});

test("expired job cannot persist a late material or debit quota", async () => {
  const h = harness({ jobStatus: "failed" });
  await assert.rejects(h.record(true), error => error.status === 409);
  assert.equal(h.used(), 0);
  assert.equal(h.archived(), 0);
});

test("failed job receipt rolls back archive and quota together", async () => {
  const h = harness({ failReceipt: true });
  await assert.rejects(h.record(true), /receipt failed/);
  assert.equal(h.used(), 0);
  assert.equal(h.archived(), 0);
  assert.equal(h.status(), "processing");
});

test("completed job cannot debit or archive the material twice", async () => {
  const h = harness();
  await h.record(true);
  assert.equal(h.status(), "done");
  await assert.rejects(h.record(true), error => error.status === 409);
  assert.equal(h.used(), 1);
  assert.equal(h.archived(), 1);
});
