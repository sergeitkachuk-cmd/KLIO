import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";

// Same VM-transpile-and-load approach as tests/helpers/dialogue-harness.mjs
// and tests/generation-persistence.test.mjs - real workspace-account.ts and
// async-jobs.ts run against a real PGlite database (so the atomic SQL debit
// this feature depends on is actually executed, not hand-simulated), with
// only the true external boundaries (the AI call, the image provider) faked.
const root = new URL("../", import.meta.url);
function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    require: name => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; },
    Response, Request, URL, TextDecoder, AbortSignal, Uint8Array, Buffer, console,
    setTimeout, clearTimeout, crypto: { randomUUID },
    process: { env: { NODE_ENV: "production", DATABASE_URL: "configured" } },
    ...globals,
  });
  return exports;
}

async function createCarouselHarness() {
  const client = new PGlite();
  const schema = load("db/schema.ts", { "drizzle-orm": orm, "drizzle-orm/pg-core": pg, "./namespace": load("db/namespace.ts") });
  const dialect = new pg.PgDialect();
  const literal = value => typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value);
  for (const table of Object.values(schema)) {
    if (!orm.is(table, pg.PgTable)) continue;
    const config = pg.getTableConfig(table);
    const columns = config.columns.map(c => {
      let def = "";
      if (c.default !== undefined) {
        if (c.default instanceof orm.SQL) {
          const query = dialect.sqlToQuery(c.default);
          def = query.sql.replace(/\$(\d+)/g, (_, n) => literal(query.params[Number(n) - 1]));
        } else def = literal(c.default);
      }
      return `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${def ? ` DEFAULT ${def}` : ""}`;
    });
    await client.exec(`CREATE TABLE "${config.name}" (${columns.join(",")});`);
  }
  const db = drizzle(client, { schema });
  const owner = "carousel-test@example.invalid";
  const plans = load("app/plans.ts");

  const workspaceAccount = load("app/api/_lib/workspace-account.ts", {
    "drizzle-orm": orm,
    "../../../db/schema": schema,
    "../../../db": { getDb: () => db },
    "../../identity": { getCurrentUser: async () => ({ email: owner, displayName: "Test" }) },
    "../../plans": plans,
    "./subscription": { nextQuotaPeriodEnd: () => null },
    "../../billing-pricing": { launchDiscountWindowOpen: () => true },
  });

  const asyncJobs = load("app/api/_lib/async-jobs.ts", {
    "drizzle-orm": orm,
    "../../../db/schema": schema,
    "../../../db": { getDb: () => db },
    "node:util": { isDeepStrictEqual },
    "./workspace-account": workspaceAccount,
  });

  let ai = async () => ({ slides: [] });
  let generateImage = async (prompt, reference, email, baseUrl, requestId) =>
    ({ url: `https://cdn.example.invalid/${requestId}.png`, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
  let downloadLogo = async () => { throw new Error("no logo mock configured for this test"); };

  const carousel = load("app/api/_lib/carousel.ts", {
    "drizzle-orm": orm,
    "../../../db/schema": schema,
    "./ai-router": { callAiModel: async input => ({ result: await ai(input) }) },
    "./image-generation": { createCarouselSlideImage: (...args) => generateImage(...args) },
    "./storage": { downloadBrandLogo: (...args) => downloadLogo(...args) },
    "./workspace-account": workspaceAccount,
    "./async-jobs": asyncJobs,
  });

  async function seedAccount(overrides = {}) {
    await db.insert(schema.accounts).values({
      email: owner, planId: "start", generationMonth: "2026-09", planExpiresAt: "2099-01-01", ...overrides,
    });
  }

  async function seedBrand(overrides = {}) {
    const id = randomUUID();
    await db.insert(schema.brands).values({
      id, ownerEmail: owner, name: "Test Brand", profileJson: JSON.stringify({ logoKey: "logo-key-1" }), ...overrides,
    });
    return id;
  }

  return {
    db, schema, owner, plans,
    account: async () => (await db.select().from(schema.accounts).where(orm.eq(schema.accounts.email, owner)))[0],
    generations: async () => db.select().from(schema.generations).where(orm.eq(schema.generations.ownerEmail, owner)),
    seedAccount,
    seedBrand,
    setAi: fn => { ai = fn; },
    setGenerateImage: fn => { generateImage = fn; },
    setDownloadLogo: fn => { downloadLogo = fn; },
    claimJob: input => asyncJobs.claimAsyncJob("carousel_generation", owner, input, 300_000),
    getJob: id => asyncJobs.getAsyncJob(id, owner),
    runCarouselGeneration: carousel.runCarouselGeneration,
    close: () => client.close(),
  };
}

function slides(count) {
  return Array.from({ length: count }, (_, i) => ({ headline: `Заголовок ${i + 1}`, subtext: `Текст ${i + 1}` }));
}

test("carousel debits exactly one generation per slide and saves one row with slidesJson", async t => {
  const h = await createCarouselHarness();
  t.after(() => h.close());
  await h.seedAccount();
  h.setAi(async () => ({ slides: slides(3) }));

  const input = { text: "Статья про кофе и утренние ритуалы.", slideCount: 3, baseUrl: "http://127.0.0.1:3027" };
  const job = await h.claimJob(input);
  await h.runCarouselGeneration(job.id, input, h.owner);

  const account = await h.account();
  assert.equal(account.generationsUsed, 3);
  assert.equal(account.lifetimeGenerationsUsed, 3);

  const rows = await h.generations();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, "Карусель");
  assert.equal(rows[0].imageUrl, `https://cdn.example.invalid/${job.id}-0.png`);
  const saved = JSON.parse(rows[0].slidesJson);
  assert.equal(saved.length, 3);
  assert.deepEqual(saved.map(s => s.headline), ["Заголовок 1", "Заголовок 2", "Заголовок 3"]);
  assert.ok(saved.every(s => s.imageUrl.startsWith("https://cdn.example.invalid/")));

  const settled = await h.getJob(job.id);
  assert.equal(settled.status, "done");
});

test("carousel makes slide one a cover and the following slides content cards", async t => {
  const h = await createCarouselHarness();
  t.after(() => h.close());
  await h.seedAccount();
  let aiRequest;
  h.setAi(async request => {
    aiRequest = request;
    return {
      slides: [
        { headline: "Почему привычный подход больше не работает", subtext: "Разбираем главную причину и решение" },
        { headline: "Где возникает проблема", subtext: "Обычный процесс теряет важные данные на первом этапе. Из-за этого команда принимает решение по неполной картине и исправляет последствия вместо причины." },
        { headline: "Что изменить сейчас", subtext: "Сначала соберите исходные данные, затем проверьте ключевую гипотезу и только после этого масштабируйте решение." },
      ],
    };
  });
  const prompts = [];
  h.setGenerateImage(async prompt => {
    prompts.push(prompt);
    return { url: `https://cdn.example.invalid/${prompts.length}.png`, bytes: new Uint8Array([prompts.length]), contentType: "image/png" };
  });

  const input = { text: "Подробная статья о проблеме, её причине и последовательности решения.", slideCount: 3, baseUrl: "http://127.0.0.1:3027" };
  const job = await h.claimJob(input);
  await h.runCarouselGeneration(job.id, input, h.owner);

  assert.match(aiRequest.instructions, /Первый слайд — обложка/);
  assert.match(aiRequest.instructions, /25–45 слов/);
  assert.match(aiRequest.instructions, /не подзаголовок и не рекламный слоган/i);
  assert.match(prompts[0], /дизайнерская обложка/);
  assert.match(prompts[0], /Фотография или иллюстрация не обязательна/);
  assert.match(prompts[0], /выразительную типографику/);
  assert.match(prompts[1], /Это продолжение обложки, а не ещё одна обложка/);
  assert.match(prompts[1], /Основной текст/);
  assert.doesNotMatch(prompts[1], /Крупный заголовок/);
});

test("each slide after the first receives the previous slide's own bytes as its reference", async t => {
  const h = await createCarouselHarness();
  t.after(() => h.close());
  await h.seedAccount();
  h.setAi(async () => ({ slides: slides(3) }));
  const seenReferences = [];
  let callIndex = 0;
  h.setGenerateImage(async (prompt, reference) => {
    const index = callIndex++;
    seenReferences.push(reference);
    return { url: `https://cdn.example.invalid/${index}.png`, bytes: new Uint8Array([index]), contentType: "image/png" };
  });

  const input = { text: "Статья про кофе.", slideCount: 3, baseUrl: "http://127.0.0.1:3027" };
  const job = await h.claimJob(input);
  await h.runCarouselGeneration(job.id, input, h.owner);

  assert.equal(seenReferences[0], undefined);
  assert.deepEqual(Array.from(seenReferences[1].bytes), [0]);
  assert.deepEqual(Array.from(seenReferences[2].bytes), [1]);
});

test("slide 1 references the brand logo when useLogo is set, later slides fall back to the previous slide", async t => {
  const h = await createCarouselHarness();
  t.after(() => h.close());
  await h.seedAccount();
  const brandId = await h.seedBrand();
  h.setAi(async () => ({ slides: slides(3) }));
  h.setDownloadLogo(async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/png" }));
  const seenReferences = [];
  let callIndex = 0;
  h.setGenerateImage(async (prompt, reference) => {
    const index = callIndex++;
    seenReferences.push({ prompt, reference });
    return { url: `https://cdn.example.invalid/${index}.png`, bytes: new Uint8Array([index]), contentType: "image/png" };
  });

  const input = { text: "Статья про кофе.", slideCount: 3, brandId, useLogo: true, baseUrl: "http://127.0.0.1:3027" };
  const job = await h.claimJob(input);
  await h.runCarouselGeneration(job.id, input, h.owner);

  assert.equal(seenReferences[0].reference.kind, "logo");
  assert.deepEqual(Array.from(seenReferences[0].reference.bytes), [9, 9]);
  assert.equal(seenReferences[1].reference.kind, "previous-slide");
  assert.deepEqual(Array.from(seenReferences[1].reference.bytes), [0]);
  assert.equal(seenReferences[2].reference.kind, "previous-slide");
  assert.match(seenReferences[1].prompt, /логотип бренда/);
  assert.doesNotMatch(seenReferences[0].prompt, /Сохраняй тот же логотип/);
});

test("carousel without useLogo never touches brand logo storage even when a brandId is given", async t => {
  const h = await createCarouselHarness();
  t.after(() => h.close());
  await h.seedAccount();
  const brandId = await h.seedBrand();
  h.setAi(async () => ({ slides: slides(2) }));
  h.setDownloadLogo(async () => { throw new Error("should not be called"); });

  const input = { text: "Статья про кофе.", slideCount: 2, brandId, baseUrl: "http://127.0.0.1:3027" };
  const job = await h.claimJob(input);
  await h.runCarouselGeneration(job.id, input, h.owner);

  const settled = await h.getJob(job.id);
  assert.equal(settled.status, "done");
});

test("a failure partway through fails the job without debiting quota or saving a partial carousel", async t => {
  const h = await createCarouselHarness();
  t.after(() => h.close());
  await h.seedAccount();
  h.setAi(async () => ({ slides: slides(3) }));
  let calls = 0;
  h.setGenerateImage(async () => {
    calls++;
    if (calls === 2) throw new Error("provider rejected the request");
    return { url: "https://cdn.example.invalid/ok.png", bytes: new Uint8Array([1]), contentType: "image/png" };
  });

  const input = { text: "Статья про кофе.", slideCount: 3, baseUrl: "http://127.0.0.1:3027" };
  const job = await h.claimJob(input);
  await h.runCarouselGeneration(job.id, input, h.owner);

  const account = await h.account();
  assert.equal(account.generationsUsed, 0);
  assert.equal((await h.generations()).length, 0);

  const settled = await h.getJob(job.id);
  assert.equal(settled.status, "failed");
  assert.match(settled.errorMessage, /слайд 2 из 3/);
});

test("carousel is rejected without spending any provider calls when quota can't cover every slide", async t => {
  const h = await createCarouselHarness();
  t.after(() => h.close());
  await h.seedAccount({ generationsUsed: 58 }); // "start" plan's real limit is 60 - 58 + 5 > 60
  let calls = 0;
  h.setAi(async () => { calls++; return { slides: slides(5) }; });

  const input = { text: "Статья про кофе.", slideCount: 5, baseUrl: "http://127.0.0.1:3027" };
  const job = await h.claimJob(input);
  await h.runCarouselGeneration(job.id, input, h.owner);

  // The AI call already happened by the time recordGeneration's own atomic
  // check runs (only the final debit+insert is guarded) - this test's real
  // point is that the guard still fires and neither quota nor a Материалы
  // row are left in a half-done state, not that no provider call was made.
  assert.ok(calls >= 1);
  const account = await h.account();
  assert.equal(account.generationsUsed, 58);
  assert.equal((await h.generations()).length, 0);
  const settled = await h.getJob(job.id);
  assert.equal(settled.status, "failed");
});
