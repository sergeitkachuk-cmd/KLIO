import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import * as util from "node:util";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Buffer, AbortSignal, ...globals,
    require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; },
  });
  return exports;
}

test("webhook key lookup recovers after an outage and verifies real RSA signatures", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "RS256" })}.${encode({ webhookType: "test", exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const token = `${content}.${crypto.sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
  let calls = 0;
  const loaded = load("app/api/_lib/tochka.ts", { "node:crypto": crypto }, { fetch: async (_url, options) => {
    assert.ok(options.signal);
    if (++calls === 1) throw new Error("temporary outage");
    return Response.json(publicKey.export({ format: "jwk" }));
  } });
  await assert.rejects(loaded.verifyTochkaWebhook(token), /temporary outage/);
  assert.equal((await loaded.verifyTochkaWebhook(token)).webhookType, "test");
  assert.equal((await loaded.verifyTochkaWebhook(token)).webhookType, "test");
  assert.equal(calls, 2);
  assert.equal(await loaded.verifyTochkaWebhook(`${content}.AAAA`), null);
});

test("active AI job is reused only for identical input, including brand", async () => {
  class WorkspaceAccessError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const active = { id: "existing", inputJson: JSON.stringify({ brandId: "brand-a", topic: "topic" }), updatedAt: new Date().toISOString() };
  const tx = {
    execute: async () => {},
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [active] }) }) }) }),
  };
  const noop = () => null;
  const loaded = load("app/api/_lib/async-jobs.ts", {
    "node:util": util,
    "drizzle-orm": { and: noop, desc: noop, eq: noop, inArray: noop, lt: noop, sql: noop },
    "../../../db": { getDb: () => ({ transaction: fn => fn(tx) }) },
    "../../../db/schema": { asyncJobs: {} },
    "./workspace-account": { WorkspaceAccessError },
  });
  assert.equal((await loaded.claimAsyncJob("generation", "test@example.invalid", { topic: "topic", brandId: "brand-a" }, 60000)).reused, true);
  await assert.rejects(loaded.claimAsyncJob("generation", "test@example.invalid", { topic: "topic", brandId: "brand-b" }, 60000), error => error.status === 409);
  active.inputJson = "corrupted";
  await assert.rejects(loaded.claimAsyncJob("generation", "test@example.invalid", { topic: "topic", brandId: "brand-a" }, 60000), error => error.status === 409);
});

function lifecycleHarness(status, refreshOnRead = false) {
  class WorkspaceAccessError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const oldTime = new Date(0).toISOString();
  const row = { id: "job", status, updatedAt: oldTime, inputJson: "{}" };
  let inserts = 0;
  const columns = Object.fromEntries(["id", "status", "updatedAt", "kind", "ownerEmail"].map(key => [key, key]));
  const tx = {
    execute: async () => {},
    select: () => ({ from: () => ({ where: () => ({
      orderBy: () => ({ limit: async () => {
        const stale = { ...row, status: "processing", updatedAt: oldTime };
        if (refreshOnRead) row.updatedAt = new Date().toISOString();
        return [stale];
      } }),
      limit: async () => [{ ...row }],
    }) }) }),
    update: () => ({ set: values => ({ where: predicate => ({ returning: async () => {
      if (!predicate(row)) return [];
      Object.assign(row, values);
      return [{ id: row.id }];
    } }) }) }),
    insert: () => ({ values: async () => { inserts++; } }),
  };
  const loaded = load("app/api/_lib/async-jobs.ts", {
    "node:util": util,
    "drizzle-orm": { and: (...conditions) => row => conditions.every(condition => condition(row)), eq: (key, value) => row => row[key] === value, inArray: (key, values) => row => values.includes(row[key]), desc: () => null, lt: () => null, sql: () => "now" },
    "../../../db": { getDb: () => ({ ...tx, transaction: fn => fn(tx) }) },
    "../../../db/schema": { asyncJobs: columns }, "./workspace-account": { WorkspaceAccessError },
  }, { crypto });
  return { ...loaded, row, inserts: () => inserts };
}

test("job processing cannot resurrect failed or completed work or launch twice", async () => {
  for (const status of ["failed", "done", "processing"]) {
    const h = lifecycleHarness(status);
    await assert.rejects(h.markAsyncJobProcessing("job"), error => error.status === 409);
    assert.equal(h.row.status, status);
  }
  const h = lifecycleHarness("pending");
  await h.markAsyncJobProcessing("job");
  assert.equal(h.row.status, "processing");
  await assert.rejects(h.markAsyncJobProcessing("job"), error => error.status === 409);
});

test("stale claim does not overwrite a concurrently completed result", async () => {
  const h = lifecycleHarness("done");
  await h.claimAsyncJob("material_generation", "owner", {}, 1000);
  assert.equal(h.row.status, "done");
  assert.equal(h.inserts(), 1);
});

test("a refreshed running job prevents another claim from launching parallel work", async () => {
  const h = lifecycleHarness("processing", true);
  await assert.rejects(h.claimAsyncJob("material_generation", "owner", {}, 1000), error => error.status === 409);
  assert.equal(h.row.status, "processing");
  assert.equal(h.inserts(), 0);
});
