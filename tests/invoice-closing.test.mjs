import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness(status = null, document = null) {
  const row = { id: "invoice", ownerEmail: "owner", closingStatus: status, closingDocumentId: document };
  const columns = Object.fromEntries(Object.keys(row).map(key => [key, key]));
  const db = { update: () => ({ set: values => ({ where: predicate => ({ returning: async () => { if (!predicate(row)) return []; Object.assign(row, values); return [{ id: row.id }]; } }) }) }) };
  const deps = { "drizzle-orm": { and: (...checks) => row => checks.every(check => check(row)), eq: (key, value) => row => row[key] === value, isNull: key => row => row[key] === null }, "../../../db/schema": { invoices: columns }, "./workspace-account": { getWorkspaceDb: async () => db } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/_lib/invoice-closing.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => deps[name] });
  return { claim: (owner = "owner") => exports.claimInvoiceClosing("invoice", owner), row };
}
test("parallel UPD claims have one winner and cannot replay uncertain work", async () => {
  const h = harness();
  assert.deepEqual(await Promise.all([h.claim(), h.claim()]), [true, false]);
  assert.equal(await h.claim(), false);
  assert.equal(h.row.closingStatus, "creating");
});
test("UPD claim rejects another owner and already created documents", async () => {
  assert.equal(await harness().claim("other"), false);
  assert.equal(await harness("created", "document").claim(), false);
  assert.equal(await harness(null, "document").claim(), false);
});
