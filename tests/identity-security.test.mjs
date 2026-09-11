import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

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
