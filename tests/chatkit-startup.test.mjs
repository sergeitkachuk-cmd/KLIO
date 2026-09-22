import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsx from "react/jsx-runtime";
import * as sdk from "@openai/chatkit-react";
import ts from "typescript";

function loadComponent(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("require", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const generationSettings = loadComponent("app/dialogue-generation-settings.ts", {
  "./content-plans": loadComponent("app/content-plans.ts"),
});

// Exercise the real React SDK with its element initially undefined, just as
// it is while the external ChatKit script is still downloading or blocked.
async function mountWorkspace(t, { savedThread = "thread-saved", storageBlocked = false } = {}) {
  const window = new Window({ url: "https://preview.example.invalid" });
  const previous = new Map();
  for (const name of ["window", "document", "customElements", "localStorage"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: name === "window" ? window : window[name],
    });
  }
  previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const uncaught = [];
  const root = createRoot(container, { onUncaughtError: (error) => uncaught.push(error) });
  const calls = [];
  let scriptProps;
  let startupTimeout;
  const originalSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, delay, ...args) => {
    if (delay === 12_000) {
      startupTimeout = fn;
      return 0;
    }
    return originalSetTimeout(fn, delay, ...args);
  };
  let props = {
    userKey: "test-user",
    brandId: null,
    brandName: "",
    brands: [],
    theme: "light",
    visible: true,
    onUsage() {},
    onNavigate() {},
    beforeProfile: async () => true,
  };
  const storageKey = "klio-chatkit:test-user:personal";
  if (savedThread) window.localStorage.setItem(storageKey, savedThread);
  if (storageBlocked) {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("Storage unavailable"); },
    });
  }
  const dependencies = {
    react: React,
    "react/jsx-runtime": jsx,
    "@openai/chatkit-react": sdk,
    "next/script": { default: (options) => { scriptProps = options; return null; } },
    "./dialogue-chatkit.css": {},
    "./dialogue-generation-settings": generationSettings,
    "./module-select": loadComponent("app/module-select.tsx", {
      react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM,
      "./help-tip": { HelpTip: () => null },
    }),
    "./dialogue-workspace-legacy": {
      LegacyDialogueWorkspace: () => React.createElement("div", { "data-legacy": "true" }, "Available dialogue"),
    },
  };
  const output = ts.transpileModule(
    readFileSync(new URL("../app/dialogue-workspace.tsx", import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const exports = {};
  const load = new Function("require", "exports", "process", output);
  load((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports, { env: { NODE_ENV: "production", NEXT_PUBLIC_CHATKIT_DOMAIN_KEY: "domain_pk_test" } });

  async function render(changes = {}) {
    props = { ...props, ...changes };
    await React.act(async () => {
      root.render(React.createElement("div", null,
        React.createElement("nav", { "data-cabinet": "true" }, "Cabinet navigation"),
        React.createElement(exports.DialogueWorkspace, props),
      ));
    });
  }
  function defineElement() {
    class TestChatKit extends window.HTMLElement {
      setOptions(options) { this.options = options; }
      async setThreadId(id) {
        calls.push(id);
        if (this.failure) throw this.failure;
        this.dispatchEvent(new window.CustomEvent("chatkit.thread.change", { detail: { threadId: id } }));
      }
      async setComposerValue(value) {
        this.composerValue = value;
        this.dispatchEvent(new window.CustomEvent("chatkit.tool.change", { detail: { toolId: value.selectedToolId } }));
      }
    }
    window.customElements.define("openai-chatkit", TestChatKit);
  }
  const element = () => container.querySelector("openai-chatkit");
  t.after(async () => {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await render();
  return {
    window, container, uncaught, calls, render, element, storageKey,
    define: () => React.act(async () => defineElement()),
    ready: () => React.act(async () => element().dispatchEvent(new window.CustomEvent("chatkit.ready"))),
    expire: () => React.act(async () => startupTimeout()),
    scriptError: () => React.act(async () => scriptProps.onError()),
    clickNew: () => React.act(async () => container.querySelector(".klio-chatkit-new").click()),
    chooseTool: (toolId) => React.act(async () => element().dispatchEvent(new window.CustomEvent("chatkit.tool.change", { detail: { toolId } }))),
    chooseOption: async (label, text) => {
      if (container.querySelector(".klio-chatkit-settings-grid")?.hidden)
        await React.act(async () => container.querySelector(".klio-chatkit-settings-toggle").click());
      const field = [...container.querySelectorAll(".module-select")].find((node) => node.querySelector(".field-label-help")?.textContent === label);
      assert.ok(field, `Missing setting: ${label}`);
      await React.act(async () => field.querySelector("button").click());
      const option = [...window.document.querySelectorAll('[role="option"]')].find((node) => node.textContent.replace("✓", "").trim() === text);
      assert.ok(option, `Missing option: ${text}`);
      await React.act(async () => option.click());
    },
  };
}

test("slow ChatKit download keeps the cabinet and loader alive until ready", async (t) => {
  const h = await mountWorkspace(t);
  assert.deepEqual(h.uncaught, []);
  assert.ok(h.container.querySelector("[data-cabinet]"));
  assert.ok(h.container.querySelector(".klio-chatkit-loading"));
  assert.equal(h.container.querySelector(".klio-chatkit-new").disabled, true);
  await h.clickNew();
  assert.deepEqual(h.calls, []);
  await h.define();
  assert.equal(h.element().options.initialThread, "thread-saved");
  await h.ready();
  assert.equal(h.container.querySelector(".klio-chatkit-loading"), null);
  assert.equal(h.container.querySelector(".klio-chatkit-new").disabled, false);
  assert.deepEqual(h.calls, []);
  await h.expire();
  assert.ok(h.element());
  assert.equal(h.container.querySelector("[data-legacy]"), null);
});

test("blocked ChatKit falls back once and does not replace the UI when its script arrives late", async (t) => {
  const h = await mountWorkspace(t);
  assert.deepEqual(h.uncaught, []);
  await h.expire();
  assert.ok(h.container.querySelector("[data-legacy]"));
  assert.ok(h.container.querySelector("[data-cabinet]"));
  await h.define();
  await h.render({ theme: "dark" });
  assert.equal(h.element(), null);
  assert.ok(h.container.querySelector("[data-legacy]"));
  assert.deepEqual(h.calls, []);
});

test("script download error selects a working dialogue without a cabinet crash", async (t) => {
  const h = await mountWorkspace(t);
  await h.scriptError();
  assert.deepEqual(h.uncaught, []);
  assert.ok(h.container.querySelector("[data-legacy]"));
  assert.ok(h.container.querySelector("[data-cabinet]"));
});

test("theme changes preserve the active widget and selecting a new chat clears stored selection", async (t) => {
  const h = await mountWorkspace(t);
  await h.define();
  await h.ready();
  const element = h.element();
  await h.render({ theme: "dark" });
  assert.equal(h.element(), element);
  assert.deepEqual(h.calls, []);
  await h.clickNew();
  assert.deepEqual(h.calls, [null]);
  assert.equal(h.window.localStorage.getItem(h.storageKey), null);
  await h.render({ theme: "light" });
  assert.deepEqual(h.calls, [null]);
  assert.equal(h.element(), element);
});

test("brand changes initialize a fresh widget with that brand's saved selection", async (t) => {
  const h = await mountWorkspace(t);
  await h.define();
  await h.ready();
  const previous = h.element();
  h.window.localStorage.setItem("klio-chatkit:test-user:brand-2", "thread-other");
  await h.render({ brandId: "brand-2" });
  assert.notEqual(h.element(), previous);
  assert.equal(h.element().options.initialThread, "thread-other");
  assert.ok(h.container.querySelector(".klio-chatkit-loading"));
  assert.deepEqual(h.calls, []);
});

test("unavailable browser storage still allows opening the chat", async (t) => {
  const h = await mountWorkspace(t, { storageBlocked: true });
  await h.define();
  await h.ready();
  assert.equal(h.element().options.initialThread, null);
  await h.clickNew();
  assert.deepEqual(h.uncaught, []);
  assert.deepEqual(h.calls, [null]);
});

test("an error after ready stays inline and never switches to another interface", async (t) => {
  const h = await mountWorkspace(t);
  await h.define();
  await h.ready();
  const element = h.element();
  t.mock.method(console, "error", () => {});
  await React.act(async () => element.dispatchEvent(new h.window.CustomEvent("chatkit.error", {
    detail: { error: new Error("Connection lost") },
  })));
  await h.expire();
  assert.ok(h.container.querySelector('[role="alert"]'));
  assert.equal(h.element(), element);
  assert.equal(h.container.querySelector("[data-legacy]"), null);
  assert.deepEqual(h.uncaught, []);
});

for (const synchronous of [false, true]) {
  test(`new chat ${synchronous ? "synchronous failure" : "rejected promise"} stays inside the dialogue`, async (t) => {
    const h = await mountWorkspace(t);
    await h.define();
    await h.ready();
    if (synchronous) h.element().setThreadId = () => { throw new Error("Widget unavailable"); };
    else h.element().failure = new Error("Widget unavailable");
    await h.clickNew();
    assert.ok(h.container.querySelector('[role="alert"]'));
    assert.deepEqual(h.uncaught, []);
    assert.ok(h.container.querySelector("[data-cabinet]"));
    assert.equal(h.window.localStorage.getItem(h.storageKey), "thread-saved");
    assert.equal(h.container.querySelector("[data-legacy]"), null);
  });
}

test("ChatKit image settings reach the submitted payload even after the SDK clears the tool", async (t) => {
  const h = await mountWorkspace(t);
  await h.define();
  await h.ready();
  await h.render({ hasLogo: true });
  await h.chooseTool("image");
  await h.chooseOption("Ориентация", "Портретная");
  await h.chooseOption("Формат файла", "WEBP");
  await React.act(async () => h.container.querySelector(".klio-chatkit-settings-logo input").click());
  await React.act(async () => h.container.querySelector(".klio-chatkit-settings-toggle").click());
  assert.equal(h.container.querySelector(".klio-chatkit-settings-grid").hidden, true);
  await h.chooseTool(null); // Native tool is one-shot; submitted payload remains authoritative.
  let sent;
  t.mock.method(globalThis, "fetch", async (request) => { sent = request; return new Response("{}"); });
  await h.element().options.api.fetch("/api/chatkit", {
    method: "POST", headers: { "x-test": "preserved" },
    body: JSON.stringify({ type: "threads.create", params: { input: { content: [{ type: "input_text", text: "Обложка" }], inference_options: { tool_choice: { id: "image" } } } } }),
  });
  assert.equal(sent.credentials, "same-origin");
  assert.equal(sent.headers.get("x-test"), "preserved");
  const payload = await sent.json();
  assert.deepEqual(payload.params.klio_settings, { imageAspectRatio: "9:16", imageOutputFormat: "webp", useLogo: true });
  assert.equal(payload.params.input.content[0].text, "Обложка");
  assert.deepEqual(h.uncaught, []);
});

test("topic and text settings are independent of plain chat and theme changes", async (t) => {
  const h = await mountWorkspace(t);
  await h.define();
  await h.ready();
  await h.chooseTool("text");
  await h.chooseOption("Формат", "SEO-статья");
  await h.chooseOption("Тон", "Экспертный");
  await h.chooseOption("Объём", "Длинный");
  await h.render({ theme: "dark" });
  const sent = [];
  t.mock.method(globalThis, "fetch", async (request) => { sent.push(await request.json()); return new Response("{}"); });
  const submit = (tool) => h.element().options.api.fetch(new Request("https://preview.example.invalid/api/chatkit", {
    method: "POST", body: JSON.stringify({ type: "threads.add_user_message", params: { thread_id: "thread-saved", input: { inference_options: { tool_choice: tool ? { id: tool } : null } } } }),
  }));
  await submit("text");
  assert.deepEqual(sent.at(-1).params.klio_settings, { format: "seo", tone: "Экспертный", length: "long" });
  await h.chooseTool("topics");
  assert.equal(h.container.textContent.includes("Объём"), false);
  await h.chooseOption("Количество тем", "8");
  await submit("topics");
  assert.deepEqual(sent.at(-1).params.klio_settings, { format: "seo", topicCount: "8" });
  await h.chooseTool(null);
  assert.equal(h.container.querySelector(".klio-chatkit-settings"), null);
  await submit(null);
  assert.deepEqual(sent.at(-1).params.klio_settings, {});
  await h.chooseTool("text");
  assert.ok(h.container.textContent.includes("Экспертный"));
  assert.ok(h.container.textContent.includes("Длинный"));
  assert.deepEqual(h.uncaught, []);
});

test("business switcher works without enabling brand context", async (t) => {
  const h = await mountWorkspace(t);
  const changed = [];
  await h.render({ brandId: "one", brandName: "Первый бизнес", brands: [{ id: "one", name: "Первый бизнес" }, { id: "two", name: "Второй бизнес" }], onBrandChange: (id) => changed.push(id) });
  await h.define();
  await h.ready();
  await React.act(async () => h.container.querySelector('[aria-label="Выбрать бизнес"]').click());
  await React.act(async () => h.container.querySelector('[role="option"][aria-selected="false"]').click());
  assert.deepEqual(changed, ["two"]);
  assert.equal(h.container.querySelector(".klio-chatkit-brand-context input").checked, false);
  assert.equal(h.container.querySelector(".klio-chatkit-brand-options"), null);
});

test("brand checkbox stays beside the composer and submits only after profile changes are saved", async (t) => {
  const h = await mountWorkspace(t);
  let resolveSave;
  let saving = false;
  await h.render({ brandId: "film", brandName: "Съёмочная компания", beforeProfile: () => {
    saving = true;
    return new Promise((resolve) => { resolveSave = resolve; });
  } });
  await h.define();
  await h.ready();
  const checkbox = h.container.querySelector(".klio-chatkit-composer-options input");
  assert.ok(checkbox);
  assert.equal(checkbox.checked, false);
  assert.equal(h.container.querySelector(".klio-chatkit-rail input"), null);
  const sent = [];
  t.mock.method(globalThis, "fetch", async (request) => { sent.push(await request.json()); return new Response("{}"); });
  const submit = () => h.element().options.api.fetch("/api/chatkit?brandContext=1", {
    method: "POST", body: JSON.stringify({ type: "threads.create", params: { input: { content: [{ type: "input_text", text: "Процесс в студии" }] } } }),
  });
  await submit();
  assert.equal(sent[0].params.klio_brand_context, false);
  assert.equal(saving, false);
  await React.act(async () => checkbox.click());
  assert.ok(h.container.querySelector(".klio-chatkit-brand-context").textContent.includes("Съёмочная компания"));
  const pending = submit();
  for (let n = 0; n < 20 && !resolveSave; n++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(saving, true);
  assert.equal(sent.length, 1, "generation must wait for the profile save");
  resolveSave(true);
  await pending;
  assert.equal(sent[1].params.klio_brand_context, true);
  await h.render({ beforeProfile: async () => false });
  await React.act(async () => assert.rejects(submit(), /Не удалось сохранить профиль/));
  assert.equal(sent.length, 2, "no generation with an unsaved profile");
  assert.match(h.container.querySelector('[role="alert"]').textContent, /Не удалось сохранить профиль/);
});

test("settings open on demand while the profile toggle remains separate from adding a logo", async (t) => {
  const h = await mountWorkspace(t);
  await h.define();
  await h.ready();
  const navigation = [];
  await h.render({ onNavigate: (module) => navigation.push(module) });
  await h.chooseTool("image");
  assert.equal(h.container.querySelector(".klio-chatkit-settings-grid").hidden, true);
  assert.ok(h.container.querySelector(".klio-chatkit-brand-context input"));
  await React.act(async () => h.container.querySelector(".klio-chatkit-settings-toggle").click());
  assert.match(h.container.querySelector("button.klio-chatkit-settings-logo").textContent, /Добавить логотип/);
  await React.act(async () => h.container.querySelector("button.klio-chatkit-settings-logo").click());
  assert.deepEqual(navigation, ["brand"]);
  await h.render({ hasLogo: true });
  assert.equal(h.container.querySelector("button.klio-chatkit-settings-logo"), null);
  assert.ok(h.container.querySelector(".klio-chatkit-settings-logo input"));
});
