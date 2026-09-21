import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { defineConfig } from "drizzle-kit";
import { pushSchema } from "drizzle-kit/api";
import { load } from "./helpers/dialogue-harness.mjs";

const name = "klio_preview_chatkit";

function configuration(env = {}) {
  const globals = { process: { env } };
  const namespace = load("db/namespace.ts", {}, globals);
  const schema = load("db/schema.ts", {
    "drizzle-orm": orm,
    "drizzle-orm/pg-core": pg,
    "./namespace": namespace,
  }, globals);
  const config = load("drizzle.config.ts", {
    "drizzle-kit": { defineConfig },
    "./db/namespace": namespace,
  }, globals).default;
  return { namespace, schema, config, globals };
}

test("preview schema rejects public, system schemas and SQL fragments", () => {
  const { getDatabaseSchemaName } = load("db/namespace.ts");
  assert.equal(getDatabaseSchemaName({}), "public");
  assert.equal(getDatabaseSchemaName({ KLIO_PREVIEW_SCHEMA: name }), name);
  for (const value of ["public", "pg_catalog", "klio_preview_", "klio_preview_x, public", "klio_preview_x;DROP SCHEMA public", "klio_preview_" + "x".repeat(41)]) {
    assert.throws(() => getDatabaseSchemaName({ KLIO_PREVIEW_SCHEMA: value }), /KLIO_PREVIEW_SCHEMA/);
  }
});

test("both PostgreSQL URL paths keep preview search_path free of public fallback", () => {
  const env = { KLIO_PREVIEW_SCHEMA: name, NODE_ENV: "production" };
  const setup = configuration(env);
  // A raw # in the password exercises the managed-DB URL parser fallback.
  for (const connectionString of ["postgresql://user:pass@localhost:5432/klio", "postgresql://user:p#ss@localhost:5432/klio"]) {
    let options;
    const postgres = (first, second) => { options = second || first; return {}; };
    const { getDb } = load("db/index.ts", {
      "drizzle-orm/postgres-js": { drizzle: () => ({}) },
      postgres: { default: postgres },
      "./schema": setup.schema,
      "./namespace": setup.namespace,
    }, { process: { env: { ...env, DATABASE_URL: connectionString } } });
    getDb();
    assert.equal(options.connection.search_path, name);
    assert.equal(options.ssl, "require");
  }
});

test("real Drizzle preview push and CRUD preserve public tables and other schemas", async () => {
  const client = new PGlite();
  try {
    const production = configuration();
    const preview = configuration({ KLIO_PREVIEW_SCHEMA: name });
    assert.deepEqual(Array.from(production.config.schemaFilter), ["public"]);
    assert.deepEqual(Array.from(preview.config.schemaFilter), [name]);
    for (const table of Object.values(preview.schema).filter(value => orm.is(value, pg.PgTable))) {
      assert.equal(pg.getTableConfig(table).schema, name);
    }

    const live = drizzle(client, { schema: production.schema });
    await (await pushSchema(production.schema, live, production.config.schemaFilter)).apply();
    const email = "client@example.invalid";
    await live.insert(production.schema.accounts).values({ email, displayName: "Client sentinel", planId: "pro", generationMonth: "2026-09" });
    await client.exec('CREATE SCHEMA unrelated; CREATE TABLE unrelated.sentinel (id integer PRIMARY KEY); INSERT INTO unrelated.sentinel VALUES (42);');
    const before = await live.select().from(production.schema.accounts);
    const structure = () => client.query("SELECT table_name, column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position");
    const beforeStructure = await structure();

    const stand = drizzle(client, { schema: preview.schema });
    const firstPush = await pushSchema(preview.schema, stand, preview.config.schemaFilter);
    assert.equal(firstPush.hasDataLoss, false);
    assert.ok(firstPush.statementsToExecute.some(sql => sql.includes(`CREATE SCHEMA "${name}"`)));
    assert.ok(firstPush.statementsToExecute.every(sql => !/"public"|"unrelated"/.test(sql)));
    await firstPush.apply();
    assert.deepEqual(await stand.select().from(preview.schema.accounts), []);
    await stand.insert(preview.schema.accounts).values({ email, displayName: "Preview", generationMonth: "2026-09" });
    await stand.update(preview.schema.accounts).set({ displayName: "Edited preview" }).where(orm.eq(preview.schema.accounts.email, email));
    assert.equal((await stand.select().from(preview.schema.accounts))[0].displayName, "Edited preview");
    await stand.delete(preview.schema.accounts).where(orm.eq(preview.schema.accounts.email, email));

    // A second deployment should not propose changes to either environment.
    const repeat = await pushSchema(preview.schema, stand, preview.config.schemaFilter);
    assert.deepEqual(repeat.statementsToExecute, []);
    assert.deepEqual(await live.select().from(production.schema.accounts), before);
    assert.deepEqual(await structure(), beforeStructure);
    assert.deepEqual((await client.query("SELECT * FROM unrelated.sentinel")).rows, [{ id: 42 }]);
  } finally {
    await client.close();
  }
});
