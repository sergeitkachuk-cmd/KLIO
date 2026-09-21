import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { defineConfig } from "drizzle-kit";
import { parseDatabaseConnection } from "../db/connection.mjs";
import { prepareDatabase, preparationSucceeded } from "../scripts/prepare-database.mjs";
import { load } from "./helpers/dialogue-harness.mjs";

test("raw and encoded managed-DB passwords work in the app and Drizzle configuration", async () => {
  const passwords = ["ordinary", "p#ss/<word^@?", "100%raw", "already%encoded", "p:a@b!$&=+"];
  for (const password of passwords) {
    for (const passwordPart of [password, encodeURIComponent(password)]) {
      const env = { DATABASE_URL: `postgresql://tester:${passwordPart}@localhost:5432/preview?sslmode=require`, KLIO_PREVIEW_SCHEMA: "klio_preview_chatkit" };
      const parsed = parseDatabaseConnection(env.DATABASE_URL);
      assert.equal(parsed.password, password);
      assert.equal(parsed.database, "preview");
      assert.equal(parsed.host, "localhost");
      const config = load("drizzle.config.ts", {
        "drizzle-kit": { defineConfig },
        "./db/namespace": load("db/namespace.ts", {}, { process: { env } }),
        "./db/connection.mjs": { parseDatabaseConnection },
      }, { process: { env } }).default;
      assert.equal(config.dbCredentials.password, password);
      assert.equal(config.dbCredentials.user, "tester");
      assert.equal(config.dbCredentials.ssl, "require");
      assert.equal("url" in config.dbCredentials, false);
      // Construct the actual driver without a query: this invokes its parser,
      // which previously threw ERR_INVALID_URL before opening a connection.
      const client = postgres(config.dbCredentials);
      assert.equal(client.options.pass, password);
      await client.end();
    }
  }
});

test("database connection parser supports postgres alias, IPv6 and port defaults", () => {
  const credentials = parseDatabaseConnection("postgres://user:password@[::1]/preview");
  assert.equal(credentials.host, "::1");
  assert.equal(credentials.port, 5432);
  assert.equal(parseDatabaseConnection("postgresql://localhost/klio").database, "klio");
});

test("invalid connection errors do not retain the supplied secret or original URL", () => {
  const input = "https://user:secret-value@invalid/db";
  assert.throws(() => parseDatabaseConnection(input), error => {
    assert.equal(error.message, "DATABASE_URL is not a valid PostgreSQL connection string.");
    assert.equal(error.input, undefined);
    assert.equal(error.cause, undefined);
    assert.ok(!String(error.stack).includes("secret-value"));
    return true;
  });
});

test("database preparation fails closed when Drizzle reports an error with exit code zero", () => {
  const logs = [];
  const env = { NODE_ENV: "production", DATABASE_URL: "postgresql://user:secret-value@localhost/preview" };
  const run = () => ({ status: 0, stdout: "Pulling schema from database...", stderr: `TypeError: Invalid URL\ncode: 'ERR_INVALID_URL'\ninput: '${env.DATABASE_URL}'` });
  assert.equal(prepareDatabase({ env, run, log: line => logs.push(line) }), false);
  assert.ok(logs.some(line => line.includes("ERR_INVALID_URL")));
  assert.ok(!logs.join("\n").includes("secret-value"));
  assert.equal(preparationSucceeded({ status: 0, stdout: "Changes applied", stderr: "Error: failed later" }), false);
  assert.equal(preparationSucceeded({ status: 1, stdout: "Changes applied" }), false);
  assert.equal(preparationSucceeded({ status: 0, stdout: "Pulling schema from database..." }), false);
  assert.equal(preparationSucceeded({ status: 0, stdout: "[✓] Changes applied" }), true);
  assert.equal(preparationSucceeded({ status: 0, stdout: "[i] No changes detected" }), true);
});

test("database preparation refuses missing production configuration and handles timeouts", () => {
  assert.equal(prepareDatabase({ env: { NODE_ENV: "production" }, run: () => assert.fail("must not run"), log: () => {} }), false);
  assert.equal(prepareDatabase({ env: { DATABASE_URL: "invalid" }, run: () => assert.fail("must not run"), log: () => {} }), false);
  assert.equal(prepareDatabase({ env: {}, run: () => ({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" } }), log: () => {} }), false);
});
