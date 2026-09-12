import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";

function load(path, env, dependencies) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, process: { env },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

function harness(mode, session = null) {
  const env = { NODE_ENV: mode, APP_USER_EMAIL: "developer@example.invalid", ADMIN_EMAILS: "owner@example.invalid" };
  const navigation = { redirect: (path) => { throw new Error(`redirect:${path}`); } };
  const legacy = load("app/chatgpt-auth.ts", env, {
    "next/navigation": navigation,
    "next/headers": { headers: async () => new Headers({ "oai-authenticated-user-email": "owner@example.invalid" }) },
  });
  const identity = load("app/identity.ts", env, {
    "next/navigation": navigation, "./chatgpt-auth": legacy,
    "./site-auth": { getSiteSessionUser: async () => session },
  });
  const admin = load("app/api/_lib/admin.ts", env, { "../../identity": identity });
  return { legacy, identity, admin };
}

test("session lookup remains request-time even without build database configuration", async () => {
  let reads = 0;
  const auth = load("app/site-auth.ts", { NODE_ENV: "production" }, {
    "node:crypto": {}, "drizzle-orm": {}, "../db": {}, "../db/schema": {},
    "next/headers": { cookies: async () => { reads++; return { get: () => undefined }; } },
  });
  assert.equal(await auth.getSiteSessionUser(), null);
  assert.equal(reads, 1, "must opt out of static prerendering before environment fallback");
});

test("forged identity headers cannot authenticate or grant admin in production", async () => {
  const h = harness("production");
  assert.equal(await h.legacy.getChatGPTUser(), null);
  assert.equal(await h.identity.getCurrentUser(), null);
  assert.equal(await h.admin.requireAdminUser(), null);
  await assert.rejects(h.identity.requireCurrentUser("/workspace"), /redirect:\/login/);
});

test("verified sessions retain identity despite forged admin headers", async () => {
  const session = { email: "visitor@example.invalid", displayName: "Visitor" };
  const h = harness("production", session);
  assert.equal(await h.identity.getCurrentUser(), session);
  assert.equal(await h.admin.requireAdminUser(), null);
});

test("verified administrator session retains access", async () => {
  const session = { email: "owner@example.invalid", displayName: "Owner" };
  assert.equal(await harness("production", session).admin.requireAdminUser(), session);
});

test("local fallback is explicit and never comes from request headers", async () => {
  assert.equal((await harness("development").identity.getCurrentUser()).email, "developer@example.invalid");
  assert.equal(await harness(undefined).identity.getCurrentUser(), null);
});

test("invalid or expired session dates fail closed without deleting during identity lookup", async () => {
  for (const expiresAt of ["invalid", new Date(0).toISOString()]) {
    let selects = 0;
    const auth = load("app/site-auth.ts", { NODE_ENV: "production", DATABASE_URL: "configured" }, {
      "node:crypto": crypto, "drizzle-orm": { eq: () => null }, "../db/schema": { sessions: { id: "id" } },
      "next/headers": { cookies: async () => ({ get: () => ({ value: "a".repeat(64) }) }) },
      "../db": { getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => { selects++; return [{ expiresAt }]; } }) }) }) }) },
    });
    assert.equal(await auth.getSiteSessionUser(), null);
    assert.equal(selects, 1);
  }
});

test("malformed session cookie is rejected before database access", async () => {
  const auth = load("app/site-auth.ts", { NODE_ENV: "production", DATABASE_URL: "configured" }, {
    "node:crypto": crypto, "drizzle-orm": {}, "../db/schema": {},
    "next/headers": { cookies: async () => ({ get: () => ({ value: "invalid" }) }) },
    "../db": { getDb: () => { throw new Error("must not query"); } },
  });
  assert.equal(await auth.getSiteSessionUser(), null);
});
