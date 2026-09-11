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
