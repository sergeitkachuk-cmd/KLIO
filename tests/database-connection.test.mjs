import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import postgres from "postgres";
import { defineConfig } from "drizzle-kit";
import { parseDatabaseConnection } from "../db/connection.mjs";
import { checkDatabaseConnection, databaseErrorCode, prepareDatabase, preparationFailureCode, preparationSucceeded } from "../scripts/prepare-database.mjs";
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

test("database preparation fails closed when Drizzle reports an error with exit code zero", async () => {
  const logs = [];
  const env = { NODE_ENV: "production", DATABASE_URL: "postgresql://user:secret-value@localhost/preview" };
  const run = () => ({ status: 0, stdout: "Pulling schema from database...", stderr: `TypeError: Invalid URL\ncode: 'ERR_INVALID_URL'\ninput: '${env.DATABASE_URL}'` });
  assert.equal(await prepareDatabase({ env, run, check: async () => {}, log: line => logs.push(line) }), false);
  assert.ok(logs.some(line => line.includes("ERR_INVALID_URL")));
  assert.ok(!logs.join("\n").includes("secret-value"));
  assert.equal(preparationSucceeded({ status: 0, stdout: "Changes applied", stderr: "Error: failed later" }), false);
  assert.equal(preparationSucceeded({ status: 1, stdout: "Changes applied" }), false);
  assert.equal(preparationSucceeded({ status: 0, stdout: "Pulling schema from database..." }), false);
  assert.equal(preparationSucceeded({ status: 0, stdout: "[✓] Changes applied" }), true);
  assert.equal(preparationSucceeded({ status: 0, stdout: "[i] No changes detected" }), true);
});

test("database preparation refuses missing production configuration and handles timeouts", async () => {
  assert.equal(await prepareDatabase({ env: { NODE_ENV: "production" }, run: () => assert.fail("must not run"), log: () => {} }), false);
  assert.equal(await prepareDatabase({ env: { DATABASE_URL: "invalid" }, run: () => assert.fail("must not run"), log: () => {} }), false);
  assert.equal(await prepareDatabase({ env: {}, check: async () => {}, run: () => ({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" } }), log: () => {} }), false);
});

test("connection failures retain a safe cause and never start schema changes", async () => {
  for (const code of ["28P01", "42501", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CONNECT_TIMEOUT"]) {
    const logs = [];
    const error = new Error("secret-value in a driver message", {
      cause: Object.assign(new Error("secret-value in nested error"), { code }),
    });
    assert.equal(await prepareDatabase({
      env: { DATABASE_URL: "postgresql://user:secret-value@localhost/preview" },
      check: async () => { throw error; },
      run: () => assert.fail("must not prepare tables after a failed connection"),
      log: line => logs.push(line),
    }), false);
    assert.ok(logs.some(line => line.includes(`Connection failed: ${code}.`)));
    assert.ok(!logs.join("\n").includes("secret-value"));
  }
  assert.equal(databaseErrorCode(new AggregateError([{ code: "ECONNREFUSED" }])), "ECONNREFUSED");
  assert.equal(databaseErrorCode({ code: "secret-value" }), "DATABASE_CONNECTION_FAILED");
  const circular = {}; circular.cause = circular;
  assert.equal(databaseErrorCode(circular), "DATABASE_CONNECTION_FAILED");
  assert.equal(preparationFailureCode({ status: 1, stdout: "Pulling schema from database..." }), "DRIZZLE_PROCESS_FAILED");
});

test("connection preflight is read-only, uses TLS and closes clients after success and timeout", async () => {
  for (const timeout of [false, true]) {
    let closed = false;
    const promise = checkDatabaseConnection({
      env: { DATABASE_URL: "postgresql://user:p#ss@localhost/preview" },
      timeoutMs: 20,
      connect: options => {
        assert.equal(options.ssl, "require");
        assert.equal(options.password, "p#ss");
        assert.equal(options.max, 1);
        return {
          unsafe: query => {
            assert.equal(query, "SELECT 1 AS klio_connection_check");
            return timeout ? new Promise(() => {}) : Promise.resolve([{ klio_connection_check: 1 }]);
          },
          end: async () => { closed = true; },
        };
      },
    });
    if (timeout) await assert.rejects(promise, { code: "CONNECTION_PREFLIGHT_TIMEOUT" });
    else await promise;
    assert.equal(closed, true);
  }
});

test("real PostgreSQL connection refusal is surfaced instead of Drizzle's silent exit", async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  const logs = [];
  assert.equal(await prepareDatabase({
    env: { NODE_ENV: "production", DATABASE_URL: `postgresql://user:secret-value@127.0.0.1:${port}/preview` },
    run: () => assert.fail("must not invoke Drizzle after connection refusal"),
    log: line => logs.push(line),
  }), false);
  assert.ok(logs.some(line => line.includes("ECONNREFUSED")));
  assert.ok(!logs.join("\n").includes("secret-value"));
});

test("schema preparation starts only after the connection check and still needs Drizzle success", async () => {
  const events = [];
  assert.equal(await prepareDatabase({
    env: {},
    check: async () => { events.push("connection"); },
    run: () => { events.push("schema"); return { status: 0, stdout: "No changes detected" }; },
    log: () => {},
  }), true);
  assert.deepEqual(events, ["connection", "schema"]);
});
