import { readFileSync } from "node:fs";
import vm from "node:vm";
import { randomUUID, createHash } from "node:crypto";
import ts from "typescript";
import Ajv from "ajv";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";

const root = new URL("../../", import.meta.url);
export function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    require: (name) => {
      if (name === "../../carousel-templates") return load("app/carousel-templates.ts");
      if (!(name in dependencies))
        throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
    Response,
    Request,
    URL,
    TextDecoder,
    AbortSignal,
    Uint8Array,
    Buffer,
    File,
    console,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID },
    process: { env: {} },
    ...globals,
  });
  return exports;
}
export const model = load("app/dialogue-model.ts");
export const imageGenerationErrors = load("app/api/_lib/image-generation-errors.ts");

export async function createDialogueHarness() {
  const client = new PGlite();
  const schema = load("db/schema.ts", {
    "drizzle-orm": orm,
    "drizzle-orm/pg-core": pg,
    "./namespace": load("db/namespace.ts"),
  });
  const dialect = new pg.PgDialect();
  const literal = (value) =>
    typeof value === "string"
      ? `'${value.replaceAll("'", "''")}'`
      : String(value);
  for (const table of Object.values(schema)) {
    if (!orm.is(table, pg.PgTable)) continue;
    const config = pg.getTableConfig(table);
    const columns = config.columns.map((c) => {
      let def = "";
      if (c.default !== undefined) {
        if (c.default instanceof orm.SQL) {
          const query = dialect.sqlToQuery(c.default);
          def = query.sql.replace(/\$(\d+)/g, (_, n) =>
            literal(query.params[Number(n) - 1]),
          );
        } else def = literal(c.default);
      }
      return `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${def ? ` DEFAULT ${def}` : ""}`;
    });
    await client.exec(`CREATE TABLE "${config.name}" (${columns.join(",")});`);
  }
  const db = drizzle(client, { schema });
  let user = { email: "dialogue-test@example.invalid", displayName: "Тест" };
  const owner = user.email;
  await db
    .insert(schema.accounts)
    .values({
      email: owner,
      planId: "start",
      generationMonth: "2026-09",
      planExpiresAt: "2099-01-01",
    });
  class WorkspaceAccessError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const plans = load("app/plans.ts");
  const contentPlans = load("app/content-plans.ts");
  const carouselTemplates = load("app/carousel-templates.ts");
  const account = async () =>
    (
      await db
        .select()
        .from(schema.accounts)
        .where(orm.eq(schema.accounts.email, owner))
    )[0];
  let calls = 0;
  const imageCalls = [];
  const imageDownloads = [];
  let editImage = async () => "https://cdn.example.invalid/edited.png";
  let tavily = async () => null;
  let ai = async (input) => {
    const context = JSON.parse(input.input);
    const text = context.messages.at(-1).text;
    if (/тем/i.test(text) && !/напиши|пост на тему/i.test(text))
      return {
        reply: "Вот темы для вашего бизнеса.",
        action: "create",
        cards: [
          {
            kind: "topic",
            title: "Знакомство с командой",
            body: "Расскажите о людях, которые создают продукт.",
          },
          {
            kind: "topic",
            title: "Как выбрать продукт",
            body: "Помогите читателю сделать выбор.",
          },
        ],
        profile: [],
      };
    if (context.selected && /сократи|измени/i.test(text))
      return {
        reply: "Текст обновлён.",
        action: "edit",
        cards: [
          {
            kind: "post",
            title: context.selected.title,
            body: "Короткий текст с сохранёнными фактами.",
          },
        ],
        profile: [],
      };
    if (/пост/i.test(text))
      return {
        reply: "Пост готов.",
        action: "create",
        cards: [
          {
            kind: "post",
            title: "Доброе утро начинается здесь",
            body: "Начните день с чашки любимого кофе. Мы готовим завтраки каждый день до 12:00. Заходите в гости!",
          },
        ],
        profile: [],
      };
    return {
      reply:
        "Давайте разберём вашу задачу. Расскажите, какого результата хотите добиться.",
      action: "reply",
      cards: [],
      profile: [],
    };
  };
  const validate = new Ajv().compile(model.DIALOGUE_SCHEMA);
  const body = load("app/api/_lib/request-body.ts");
  const workspace = {
    WorkspaceAccessError,
    getWorkspaceDb: async () => db,
    workspaceIdentity: async () => {
      if (!user) throw new WorkspaceAccessError("Войдите", 401);
      return user;
    },
    ensureAccount: async () => account(),
    assertPlanActive: (a) => {
      if (a.planExpiresAt === "2000-01-01")
        throw new WorkspaceAccessError("Тариф закончился", 402);
    },
    assertGenerationQuotaAvailable: async () => {},
    assertSecondaryQuotaAvailable: async () => {},
    workspaceErrorResponse: (error) =>
      Response.json({ error: error.message }, { status: error.status || 500 }),
  };
  class AiCallError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  const carouselCalls = [];
  let carouselImage = async (...args) => ({ url: `https://cdn.example.invalid/${args[4]}.png`, bytes: new Uint8Array([1]), contentType: "image/png" });
  const carousel = load("app/api/_lib/carousel.ts", {
    "drizzle-orm": orm, "../../../db/schema": schema,
    "./ai-router": { callAiModel: async (input) => { calls++; return { result: await ai(input) }; } },
    "./image-generation": { createCarouselSlideImage: async (...args) => { carouselCalls.push(args); return carouselImage(...args); } },
    "./storage": { downloadBrandLogo: async () => ({ bytes: new Uint8Array([2]), contentType: "image/png" }) },
    "./workspace-account": workspace, "./async-jobs": {}, "../../carousel-templates": carouselTemplates,
  });
  const route = load(
    "app/api/dialogue/route.ts",
    {
      "drizzle-orm": orm,
      "../../../db/schema": schema,
      "../../dialogue-model": model,
      "../../dialogue-starters": load("app/dialogue-starters.ts"),
      "../_lib/dialogue-image-source": load("app/api/_lib/dialogue-image-source.ts", {
        "node:crypto": { createHash }, "../../dialogue-image-source": load("app/dialogue-image-source.ts"), "../../dialogue-starters": load("app/dialogue-starters.ts"),
      }),
      "../../plans": plans,
      "../../content-plans": contentPlans,
      "../../dialogue-generation-settings": load("app/dialogue-generation-settings.ts", { "./content-plans": contentPlans, "./carousel-templates": carouselTemplates }),
      "../_lib/ai-config": {
        aiConfigured: () => true,
        OPERATION_CONFIG: { dialogue_plain: { model: "gpt-5.6-luna" }, dialogue_deepseek_plain: { model: "deepseek-flash" } },
      },
      "../_lib/ai-router": {
        AiCallError,
        callAiModel: async (input) => {
          calls++;
          const result = await ai(input);
          if (input.operation === "dialogue_plain" || input.operation === "dialogue_deepseek_plain") return { result: typeof result.raw === "string" ? result : { raw: result.reply } };
          if (!validate(result)) throw new Error("Invalid AI schema");
          return { result };
        },
      },
      "../_lib/request-body": body,
      "../_lib/request-origin": {
        hasUnsafeRequestOrigin: (r) =>
          r.headers.get("origin") === "https://evil.invalid",
      },
      "../_lib/rate-limit": { isRateLimited: () => false },
      "../_lib/workspace-account": workspace,
      "../_lib/tavily": { researchAdaptationFacts: async (...args) => tavily(...args) },
      "../_lib/website-context": {
        readWebsiteContext: async () => ({ status: "loaded", text: "Кофейня" }),
      },
      "../_lib/base-url": { resolveBaseUrl: () => "http://127.0.0.1:3027" },
      "../_lib/image-generation": {
        imageConfigured: () => true,
        createImage: async (...args) => { imageCalls.push({ logo: false, args }); return "https://cdn.example.invalid/generated.png"; },
        createImageFromLogo: async (...args) => { imageCalls.push({ logo: true, args }); return "https://cdn.example.invalid/generated-with-logo.png"; },
        createImageFromSource: async (...args) => { imageCalls.push({ source: true, logo: Boolean(args[3]), args }); return editImage(...args); },
      },
      "../_lib/image-generation-errors": imageGenerationErrors,
      "../_lib/image-usage": { recordImageUsage: async () => {} },
      "../_lib/storage": {
        downloadBrandLogo: async () => ({ bytes: new Uint8Array(), contentType: "image/png" }),
        downloadPublicationImage: async (key) => { imageDownloads.push(key); return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }; },
      },
      "../_lib/dialogue-image-prompt": load("app/api/_lib/dialogue-image-prompt.ts"),
      "../_lib/carousel": carousel,
      "../../carousel-templates": carouselTemplates,
    },
    {
      fetch: async () => {
        throw new Error("External network forbidden in tests");
      },
    },
  );
  const request = async (data, headers = {}) =>
    route.POST(
      new Request("http://127.0.0.1:3027/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(data),
      }),
    );
  const post = async (data) => {
    const response = await request(data);
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(value.error), { status: response.status });
    return value;
  };
  const create = async (brandId = "") =>
    (await post({ action: "create", id: randomUUID(), brandId })).thread;
  const read = async (id) => {
    const response = await route.GET(
      new Request(`http://127.0.0.1:3027/api/dialogue?id=${id}`),
    );
    return { status: response.status, ...(await response.json()) };
  };
  const settled = async (id) => {
    for (let n = 0; n < 120; n++) {
      const data = await read(id);
      if (data.thread.status !== "processing") return data.thread;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Worker did not settle");
  };
  return {
    client,
    db,
    schema,
    route,
    request,
    post,
    create,
    read,
    settled,
    account,
    owner,
    calls: () => calls,
    imageCalls,
    imageDownloads,
    setEditImage: (value) => { editImage = value; },
    carouselCalls,
    setCarouselImage: (value) => { carouselImage = value; },
    AiCallError,
    setAi: (value) => {
      ai = value;
    },
    setTavily: (value) => {
      tavily = value;
    },
    setUser: (value) => {
      user = value;
    },
    close: () => client.close(),
  };
}
