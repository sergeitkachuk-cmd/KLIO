import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness({ failDelete = false } = {}) {
  let row = { id: "brand", ownerEmail: "owner", updatedAt: "v1", name: "Initial" };
  let writes = 0;
  const brands = { id: "id", ownerEmail: "ownerEmail", updatedAt: "updatedAt" };
  const tables = { brands, publications: {}, socialChannels: {}, materials: {}, generations: {} };
  let deleted = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ then: resolve => Promise.resolve([{ count: 1 }]).then(resolve), limit: async () => [row] }) }) }),
    delete: table => ({ where: async () => {
      if (failDelete && table === tables.materials) throw new Error("storage failure");
      deleted.push(table);
    } }),
    transaction: async work => {
      const before = [...deleted];
      try { return await work(db); } catch (error) { deleted = before; throw error; }
    },
    update: () => ({ set: values => ({ where: predicate => ({ returning: async () => {
      if (!predicate(row)) return [];
      row = { ...row, ...values, updatedAt: `v${++writes + 1}` };
      return [row];
    } }) }) }),
  };
  const dependencies = {
    "drizzle-orm": { eq: (key, value) => row => row[key] === value, and: (...checks) => row => checks.every(check => check(row)), desc: () => null, sql: () => null },
    "../../../db/schema": tables,
    "../../plans": { planRule: () => ({ brandLimit: 5 }) },
    "../_lib/workspace-account": {
      workspaceDatabaseAvailable: async () => true, workspaceIdentity: async () => ({ email: "owner", displayName: "Owner" }),
      getWorkspaceDb: async () => db, ensureAccount: async () => ({}), accountSummary: () => ({}),
      workspaceErrorResponse: error => { throw error; },
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Response, require: name => {
    if (!(name in dependencies)) throw new Error(name);
    return dependencies[name];
  } });
  return {
    save: (version, name, brandId = "brand") => exports.POST({ json: async () => ({ action: "save_brand", brandId, expectedUpdatedAt: version, profile: { name }, workspace: {} }) }),
    row: () => row, writes: () => writes,
    remove: () => exports.POST({ json: async () => ({ action: "delete_brand", brandId: "brand" }) }),
    deleted: () => deleted.length,
  };
}

test("two tabs on the same version cannot overwrite each other", async () => {
  const h = harness();
  const results = await Promise.all([h.save("v1", "Tab A"), h.save("v1", "Tab B")]);
  assert.deepEqual(results.map(r => r.status), [200, 409]);
  assert.equal(h.row().name, "Tab A");
  assert.equal(h.writes(), 1);
  assert.equal((await h.save("v2", "Next edit")).status, 200);
});

test("old clients without a version and wrong brand IDs cannot write", async () => {
  const h = harness();
  assert.equal((await h.save(undefined, "Old client")).status, 428);
  assert.equal((await h.save("v1", "Wrong brand", "another")).status, 409);
  assert.equal(h.writes(), 0);
});

test("brand deletion rolls back earlier deletions after a storage failure", async () => {
  const h = harness({ failDelete: true });
  await assert.rejects(h.remove(), /storage failure/);
  assert.equal(h.deleted(), 0);
});

test("successful brand deletion commits all five scoped deletions", async () => {
  const h = harness();
  assert.equal((await h.remove()).status, 200);
  assert.equal(h.deleted(), 5);
});
