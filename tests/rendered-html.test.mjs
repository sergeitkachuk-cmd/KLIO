import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

const bindings = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};

const context = { waitUntil() {}, passThroughOnException() {} };

async function loadWorker(label) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(label, `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

test("renders development preview metadata", async () => {
  const worker = await loadWorker("preview-meta");
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), bindings, context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await response.text(), developmentPreviewMeta);
});

test("workspace presents optional tools and removes the brand control test", async () => {
  const worker = await loadWorker("workspace-ui");
  const response = await worker.fetch(
    new Request("http://localhost/workspace", {
      headers: { accept: "text/html", "oai-authenticated-user-email": "test@example.com" },
    }),
    bindings,
    context,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Начните без лишних этапов/);
  assert.match(html, /Самостоятельный инструмент · по желанию/);
  assert.match(html, /AI‑контур/);
  assert.match(html, /Генератор материалов/);
  assert.match(html, /Генерировать материал/);
  assert.doesNotMatch(html, /Контрольный тест/);
});

test("AI endpoints reject requests when the server key is missing instead of returning demo copy", async () => {
  const worker = await loadWorker("no-ai-fallback");
  const requests = [
    ["/api/generate", {
      format: "seo",
      topic: "регулирование криптовалют в России",
      keywords: "регулирование криптовалют, налоги на криптовалюту",
      length: 800,
      useBrand: false,
    }],
    ["/api/semantics", { query: "регулирование криптовалют в России", geography: [] }],
    ["/api/content-plan", { query: "регулирование криптовалют в России", count: 10 }],
    ["/api/adapt", {
      sourceText: "Криптовалютные операции требуют отдельного учёта рисков, источников фактов и действующих правил. ".repeat(8),
      goal: "seo",
      useBrand: false,
    }],
    ["/api/content-plan/replace", {
      query: "регулирование криптовалют в России",
      selectedItems: [{ id: "plan-1", title: "Налоги на криптовалюту", cluster: "Право" }],
      existingTitles: ["Налоги на криптовалюту"],
    }],
  ];

  for (const [path, body] of requests) {
    const response = await worker.fetch(new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    }), bindings, context);
    assert.equal(response.status, 503, `${path} must be unavailable without AI configuration`);
    const payload = await response.json();
    assert.equal(payload.code, "AI_NOT_CONFIGURED");
    assert.equal("material" in payload, false);
    assert.equal("result" in payload, false);
    assert.doesNotMatch(JSON.stringify(payload), /санатор/i);
  }
});

test("automatic competitor discovery never invents URLs without AI web search", async () => {
  const worker = await loadWorker("no-ai-search");
  const response = await worker.fetch(new Request("http://localhost/api/competitors/discover", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: "биржа криптовалют для бизнеса" }),
  }), bindings, context);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(Array.isArray(payload.candidates), false);
  assert.match(payload.error, /AI|ИИ/i);
});

test("semantic and content-plan prompts implement expert SEO classification without fake frequency", async () => {
  const [semanticRoute, planRoute] = await Promise.all([
    readFile(new URL("../app/api/semantics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/content-plan/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(semanticRoute, /Широкий.*Средний.*Узкий/s);
  assert.match(semanticRoute, /Ядро.*Синоним.*Проблема.*Решение.*Смежный/s);
  assert.match(semanticRoute, /не придумывай частотность/i);
  assert.match(semanticRoute, /requestStructuredJson/);
  assert.match(planRoute, /Сбалансируй воронку/i);
  assert.match(planRoute, /не делай весь план информационными инструкциями/i);
  assert.match(planRoute, /evidenceNeeded/);
  assert.match(planRoute, /requestStructuredJson/);
});

test("format contracts preserve the concrete subject and marketing purpose", async () => {
  const contracts = await readFile(new URL("../app/content-plans.ts", import.meta.url), "utf8");
  assert.match(contracts, /Запрещено подменять его инструкцией «как выбрать» категорию/i);
  assert.match(contracts, /Пост для соцсетей/);
  assert.match(contracts, /Рекламный текст/);
  assert.match(contracts, /Текст для сайта/);
  assert.match(contracts, /каждую выбранную ключевую фразу/i);
});

test("brand materials use an isolated article editor and protected save actions", async () => {
  const [experience, workspaceRoute] = await Promise.all([
    readFile(new URL("../app/textora-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(experience, /Материалы \/ редактор КЛИО/);
  assert.match(experience, />В редактор <Icon name="arrow"\/>/);
  assert.match(experience, /archive-editor-overlay/);
  assert.match(experience, /aria-modal="true"/);
  assert.match(experience, /текущий черновик генератора не изменяется/i);
  assert.match(experience, /Сохранить как копию/);
  assert.doesNotMatch(experience, /Открыть в генераторе/);
  assert.match(workspaceRoute, /action === "update_generation"/);
  assert.match(workspaceRoute, /action === "copy_generation"/);
  assert.match(workspaceRoute, /action === "save_material"/);
  assert.match(workspaceRoute, /MATERIAL_TYPES/);
  assert.match(workspaceRoute, /quotaUsed: false/);
  assert.match(workspaceRoute, /eq\(generations\.ownerEmail, user\.email\)/);
});

test("workspace hierarchy, editor growth and brand-isolated material filters are explicit", async () => {
  const [experience, styles] = await Promise.all([
    readFile(new URL("../app/textora-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(experience, /materialsFilter/);
  assert.match(experience, /Все материалы/);
  assert.match(experience, /Фильтр материалов по типу/);
  assert.match(experience, /activeBrandSavedMaterials/);
  assert.doesNotMatch(experience, /archiveBrandFilter/);
  assert.match(experience, /adaptation-goal-scenario/);
  assert.match(experience, /Сценарий режима/);
  assert.match(experience, /adaptation-source-textarea/);
  assert.match(styles, /\.adaptation-source-field textarea\.adaptation-source-textarea[\s\S]*max-height:[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.workspace-module > \.workspace-module-heading[\s\S]*backdrop-filter: blur/);
  assert.match(styles, /\.workspace-history-filters/);
});

test("generator modules are optional real brief sources and the workspace uses deep navy hierarchy", async () => {
  const [experience, generateRoute, styles] = await Promise.all([
    readFile(new URL("../app/textora-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(experience, /Контекст КЛИО/);
  assert.match(experience, />Профиль бренда</);
  assert.match(experience, />Семантика</);
  assert.match(experience, />Анализ конкурентов</);
  assert.match(experience, /useBrandContext/);
  assert.match(experience, /useSemanticContext/);
  assert.match(experience, /useCompetitorContext/);
  assert.match(experience, /checked=\{generatorUseSemantics\}/);
  assert.match(experience, /checked=\{generatorUseCompetitors\}/);
  assert.doesNotMatch(experience, /disabled=\{!generatorSemanticsReady\}/);
  assert.doesNotMatch(experience, /disabled=\{!generatorCompetitorsReady\}/);
  assert.match(generateRoute, /semantic_module/);
  assert.match(generateRoute, /competitor_module/);
  assert.match(generateRoute, /activeEditorialFocuses/);
  assert.match(styles, /--deep-navy:\s*#051a31/);
  assert.match(styles, /\.mvp-flow[\s\S]*linear-gradient\(120deg, #04162b, #0a3155 66%, #071f38\)/);
  assert.match(styles, /\.brief-panel \.generator-advanced-toggle small[\s\S]*rgba\(255, 255, 255, 0\.76\)/);
  assert.match(styles, /\.archive-editor-meta span[\s\S]*font-size:\s*13px/);
});

test("three quota categories and content-plan topic replacement are enforced", async () => {
  const [experience, plans, accountHelper, replacementRoute, schema] = await Promise.all([
    readFile(new URL("../app/textora-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/plans.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/_lib/workspace-account.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/content-plan/replace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(plans, /researchLimit:\s*10/);
  assert.match(plans, /editorActionLimit:\s*100/);
  assert.match(plans, /researchLimit:\s*50/);
  assert.match(plans, /editorActionLimit:\s*500/);
  assert.match(plans, /researchLimit:\s*150/);
  assert.match(plans, /editorActionLimit:\s*2000/);
  assert.match(accountHelper, /recordResearch/);
  assert.match(accountHelper, /recordEditorialAction/);
  assert.match(schema, /materials = sqliteTable/);
  assert.match(experience, /Заменить выбранные/);
  assert.match(experience, /не более пяти тем/);
  assert.match(experience, /Сохранить в материалы/);
  assert.match(replacementRoute, /minItems:\s*2/);
  assert.match(replacementRoute, /recordEditorialAction/);
});

test("Klio editors use a distinct branded system, selectable tone and Russian SEO fields", async () => {
  const [experience, contracts, adaptRoute] = await Promise.all([
    readFile(new URL("../app/textora-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/content-plans.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/adapt/route.ts", import.meta.url), "utf8"),
  ]);
  for (const name of [
    "КЛИО Чистота", "КЛИО Ясность", "КЛИО Пересборка", "КЛИО Сжатие",
    "КЛИО Захват", "КЛИО Финал", "КЛИО Редсовет", "КЛИО Пульс",
    "КЛИО Поиск", "КЛИО Витрина", "КЛИО Отклик", "КЛИО Контакт",
  ]) assert.match(contracts, new RegExp(name));
  assert.match(experience, /Редакторы КЛИО/);
  assert.match(experience, /SEO‑заголовок/);
  assert.match(experience, /Метаописание/);
  assert.match(experience, /brand-menu-list/);
  assert.match(experience, /Один запуск режима расходует одно редакторское действие/);
  assert.match(adaptRoute, /tone_contract/);
  assert.match(adaptRoute, /TONE_PLANS/);
});
