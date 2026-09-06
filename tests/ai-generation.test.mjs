import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real TS modules with only HTTP, credentials and DB isolated.
// No API keys, paid model calls or application records are used by tests.
function loadTs(path, globals, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, ...globals,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: path });
  return exports;
}

function harness(fetchImpl, clock = Date) {
  const calls = [];
  const globals = {
    process: { env: { AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-only" } },
    Date: clock, AbortSignal, DOMException, setTimeout,
    console: { error() {} },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
      return fetchImpl(url, init);
    },
  };
  const config = loadTs("app/api/_lib/ai-config.ts", globals);
  const router = loadTs("app/api/_lib/ai-router.ts", globals, {
    "./ai-config": config,
    "../../../db": { getDb() { throw new Error("DB access forbidden"); } },
    "../../../db/schema": {},
  });
  const budget = loadTs("app/api/_lib/generation-budget.ts", globals, { "./ai-router": router, "./ai-config": config });
  return { ...router, ...budget, calls, config, globals };
}

const params = {
  operation: "generate_seo_article", instructions: "Return JSON", input: "Write an article",
  schemaName: "material", schema: { type: "object", properties: { body: { type: "string" } } },
};
const message = (text, phase = "final_answer") => ({
  type: "message", phase, content: [{ type: "output_text", text }],
});
const json = (body) => Response.json({ status: "completed", ...body });

test("5600-character article keeps thinking with extra headroom and externally supplied research", async () => {
  const h = harness(() => json({ output_text: '{"body":"article"}' }));
  const result = await h.callAiModel({ ...params, maxOutputTokensOverride: h.materialOutputTokenBudget(5600, "generate_seo_article") });
  assert.equal(result.result.body, "article");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.reasoning.effort, "low");
  assert.equal(h.calls[0].body.tools, undefined);
  assert.equal(h.calls[0].body.max_output_tokens, 7542);
  assert.ok(h.calls[0].signal);
});

test("reasoning-only empty response is billed once, including retryable utility operations", async () => {
  for (const operation of ["generate_seo_article", "generate_social_post", "normalize_quick_brief"]) {
    const h = harness(() => json({ output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "internal" }] }] }));
    await assert.rejects(h.callAiModel({ ...params, operation }), { status: 502 });
    assert.equal(h.calls.length, 1, operation);
  }
});

test("incomplete output is never accepted even if it contains parseable JSON", async () => {
  const h = harness(() => json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: '{"body":"partial"}' }));
  await assert.rejects(h.callAiModel(params), { status: 502 });
  assert.equal(h.calls.length, 1);
});

test("extracts all final text parts without commentary or reasoning", async () => {
  const final = message("");
  final.content = [{ type: "output_text", text: '{"body":' }, { type: "output_text", text: '"article"}' }];
  const h = harness(() => json({ output: [message("Searching...", "commentary"), { type: "reasoning" }, final] }));
  assert.equal((await h.callAiModel(params)).result.body, "article");
});

test("refusal is not hidden by earlier text parts", async () => {
  const h = harness(() => json({ output: [message('{"body":"draft"}'), { type: "message", content: [{ type: "refusal" }] }] }));
  await assert.rejects(h.callAiModel(params), { status: 422 });
  assert.equal(h.calls.length, 1);
});

test("malformed material JSON does not silently replay generation", async () => {
  const h = harness(() => json({ output_text: '{"body":' }));
  await assert.rejects(h.callAiModel(params), { status: 502 });
  assert.equal(h.calls.length, 1);
});

test("a body that stalls after HTTP headers times out without fallback", async () => {
  const h = harness((_url, { signal }) => ({
    status: 200, ok: true,
    text: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  }));
  const keepAlive = setInterval(() => {}, 100);
  try {
    await assert.rejects(h.callAiModel({ ...params, operation: "normalize_quick_brief", requestTimeoutMs: 25 }), { status: 504 });
    assert.equal(h.calls.length, 1);
  } finally {
    clearInterval(keepAlive);
  }
});

test("retryable utility can recover structured output within the same deadline", async () => {
  let count = 0;
  const h = harness(() => json({ output_text: ++count === 1 ? "invalid" : '{"body":"fixed"}' }));
  const result = await h.callAiModel({ ...params, operation: "normalize_quick_brief" });
  assert.equal(result.result.body, "fixed");
  assert.equal(h.calls.length, 2);
  assert.equal(result.usage.retryCount, 1);
});

test("non-retryable condensing never falls back to a full content model", async () => {
  const h = harness(() => new Response("unavailable", { status: 503 }));
  await assert.rejects(h.callAiModel({ ...params, operation: "condense_overflow" }), { status: 503 });
  assert.equal(h.calls.length, 1);
});

test("generation passes share one deadline instead of resetting the budget", () => {
  let now = 1000;
  class Clock extends Date { static now() { return now; } }
  const h = harness(() => {}, Clock);
  const budget = h.createGenerationBudget(110_000);
  assert.equal(budget.timeoutMs(85_000), 85_000);
  now += 100_000;
  assert.equal(budget.timeoutMs(25_000), 10_000);
  now += 10_000;
  assert.equal(budget.remainingMs(), 0);
  assert.throws(() => budget.timeoutMs(20_000), { status: 504 });
});

function routeHarness(h, quick = false) {
  const records = [];
  const prefix = quick ? "../../_lib/" : "../_lib/";
  const dependencies = {
    [`${prefix}ai-router`]: h,
    [`${prefix}ai-config`]: h.config,
    [`${prefix}generation-budget`]: h,
    [`${prefix}text-length`]: loadTs("app/api/_lib/text-length.ts", h.globals),
    [`${prefix}rate-limit`]: { isAiRateLimited: () => false },
    [`${prefix}workspace-account`]: {
      assertGenerationQuotaAvailable: async () => {},
      workspaceIdentity: async () => ({ email: "test@example.invalid" }),
      recordGeneration: async (record) => { records.push(record); return { archive: { id: "test" } }; },
      WorkspaceAccessError: class extends Error {},
    },
    [`${prefix}website-context`]: { readWebsiteContext: async () => ({ status: "not_provided" }) },
    [`${prefix}tavily`]: { researchMaterialWeb: async () => ({ results: Array.from({ length: 5 }, (_, i) => ({ title: `Source ${i}`, url: `https://example.invalid/${i}`, content: `Verified context ${i}` })) }) },
    "../../content-plans": loadTs("app/content-plans.ts", h.globals),
  };
  const route = loadTs(`app/api/generate/${quick ? "quick/" : ""}route.ts`, { ...h.globals, Response }, dependencies);
  return { ...route, records };
}

test("every advanced format returns and records material with thinking and external research in one provider call", async () => {
  for (const [format, length] of [["seo", 5600], ["social", 1000], ["ads", 700], ["landing", 3500]]) {
    const sentence = "Кофе раскрывает аромат после помола. Для кофе важны свежие зёрна и чистая вода.\n\n";
    const draft = { title: "Кофе", subtitle: "Вкус кофе", body: sentence.repeat(Math.floor((length - 30) / sentence.length)), meta_title: "Кофе", meta_description: "Вкус кофе", editorial_comment: "" };
    const h = harness(() => json({ output_text: JSON.stringify(draft) }));
    const route = routeHarness(h);
    const response = await route.POST(new Request("https://example.invalid/api/generate", { method: "POST", body: JSON.stringify({ format, length, topic: "Кофе", useBrand: false }) }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.ok(result.material.body.length > length * 0.85);
    assert.equal(result.mode, "ai");
    assert.ok(result.coverage);
    assert.equal(result.usage.archive.id, "test");
    assert.equal(route.records.length, 1);
    assert.equal(h.calls.length, 1);
    assert.ok(h.calls[0].body.input.includes("Verified context"));
    assert.ok(h.calls[0].body.input.includes("Verified context 4"));
    assert.equal(h.calls[0].body.reasoning.effort, "low");
    assert.doesNotMatch(h.calls[0].body.instructions, /выполни веб[‑-]поиск/i);
  }
});

test("empty provider response returns an API error without recording a generation", async () => {
  const h = harness(() => json({ output: [] }));
  const route = routeHarness(h);
  const response = await route.POST(new Request("https://example.invalid/api/generate", { method: "POST", body: JSON.stringify({ format: "seo", length: 5600, topic: "Кофе" }) }));
  assert.equal(response.status, 502);
  assert.ok((await response.json()).error);
  assert.equal(route.records.length, 0);
  assert.equal(h.calls.length, 1);
});

test("quick generation supplies bounded research and keeps the draft when condensing times out", async () => {
  let now = 0;
  class Clock extends Date { static now() { return now; } }
  const h = harness((_url, { body }) => {
    const request = JSON.parse(body);
    if (request.text.format.name === "klio_quick_brief") {
      return json({ output_text: JSON.stringify({ format: "social", topic: "Кофе", tone: "Экспертный", target_length: 1000 }) });
    }
    // The provider returned a valid draft just as the total budget expired.
    now = 90_000;
    return json({ output_text: JSON.stringify({ title: "Кофе", body: "Кофе раскрывает аромат после помола. ".repeat(50), format: "social", tone: "Экспертный" }) });
  }, Clock);
  const route = routeHarness(h, true);
  const response = await route.POST(new Request("https://example.invalid/api/generate/quick", { method: "POST", body: JSON.stringify({ prompt: "Напиши пост о приготовлении кофе", lengthHint: 1000 }) }));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.ok(result.material.body.length > 0);
  assert.ok(result.material.body.length <= 1150);
  assert.equal(h.calls.length, 2);
  assert.equal(route.records.length, 1);
  assert.ok(h.calls[1].body.input.includes("Verified context"));
  assert.ok(h.calls[1].body.input.includes("Verified context 4"));
  assert.equal(h.calls[1].body.reasoning.effort, "low");
  assert.doesNotMatch(h.calls[1].body.instructions, /выполни веб[‑-]поиск/i);
});

test("thinking headroom applies to every writing format but not mechanical condensing", () => {
  const h = harness(() => {});
  for (const operation of ["generate_seo_article", "generate_social_post", "generate_ad_copy", "generate_landing", "generate_quick_material", "revise_content"]) {
    assert.equal(h.materialOutputTokenBudget(1000, operation), 3403);
    assert.equal(h.materialOutputTokenBudget(5600, operation), 7542);
    assert.ok(h.materialOutputTokenBudget(30000, operation) <= h.config.OPERATION_CONFIG[operation].maxOutputTokens);
    assert.equal(h.config.OPERATION_CONFIG[operation].retryable, false);
  }
  assert.equal(h.materialOutputTokenBudget(5600, "condense_overflow"), 3446);
});

test("material research retains substantial source passages and caches separately from content plans", async () => {
  const requests = [];
  const research = loadTs("app/api/_lib/tavily.ts", {
    process: { env: { TAVILY_API_KEY: "test-only" } }, Date, AbortSignal,
    console: { warn() {} },
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      assert.ok(init.signal);
      return Response.json({ results: Array.from({ length: 6 }, (_, i) => ({ title: `Source ${i}`, url: `https://example.invalid/${i}`, content: "Evidence passage. ".repeat(150) })) });
    },
  });
  const material = await research.researchMaterialWeb("Coffee", []);
  assert.equal(requests[0].search_depth, "advanced");
  assert.equal(requests[0].chunks_per_source, 3);
  assert.equal(material.results.length, 5);
  assert.equal(material.results[0].content.length, 1800);
  await research.researchMaterialWeb("Coffee", []);
  assert.equal(requests.length, 1);
  const plan = await research.researchContentPlanWeb("Coffee", []);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].search_depth, "fast");
  assert.equal(plan.results[0].content.length, 420);
});

test("unavailable external research fails softly and never loops", async () => {
  let count = 0;
  const research = loadTs("app/api/_lib/tavily.ts", {
    process: { env: { TAVILY_API_KEY: "test-only" } }, Date, AbortSignal,
    console: { warn() {} },
    fetch: async () => { count++; throw new DOMException("timeout", "TimeoutError"); },
  });
  assert.equal(await research.researchMaterialWeb("Coffee", []), null);
  assert.equal(count, 1);
});
