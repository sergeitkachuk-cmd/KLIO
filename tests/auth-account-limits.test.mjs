import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

for (const [route, allowance] of [["login", 30], ["forgot-password", 3], ["resend-verification", 3]]) {
  test(`${route} limits one normalized account despite rotating IPs`, async () => {
    let reads = 0;
    const buckets = new Map();
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => { reads++; return []; } }) }) }) };
    const deps = {
      "drizzle-orm": { eq: () => null },
      "../../../../db/schema": { accounts: {} },
      "../../../../db": { getDb: () => db },
      "../../_lib/request-body": { readBoundedJson: request => request.json(), RequestBodyError: class extends Error {} },
      "../../_lib/rate-limit": {
        clientIp: request => request.headers.get("x-test-ip"),
        isRateLimited: (key, limit) => { const count = (buckets.get(key) ?? 0) + 1; buckets.set(key, count); return count > limit; },
      },
      "../../_lib/workspace-account": { workspaceDatabaseAvailable: async () => true, getWorkspaceDb: async () => db, workspaceErrorResponse: error => { throw error; } },
      "../../_lib/password": { verifyPassword: () => { throw new Error("unexpected password check"); } },
      "../../../site-auth": { createSiteSession: () => { throw new Error("unexpected session"); } },
      "../../_lib/email": { emailDeliveryAvailable: () => true },
      "../../_lib/base-url": {}, "../../_lib/password-reset": {}, "../../_lib/verification": {},
    };
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../app/api/auth/${route}/route.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Response, console, require: name => { if (!(name in deps)) throw new Error(name); return deps[name]; } });
    let last;
    for (let index = 0; index < allowance + 2; index++) {
      last = await exports.POST(new Request(`https://example.invalid/api/auth/${route}`, { method: "POST", headers: { "x-test-ip": String(index) }, body: JSON.stringify({ email: index % 2 ? " User@Example.Invalid " : "user@example.invalid", password: "wrong" }) }));
    }
    assert.equal(reads, allowance);
    assert.equal(last.status, route === "login" ? 429 : 200);
    if (route !== "login") assert.equal((await last.json()).ok, true);
  });
}
