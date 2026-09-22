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
async function mountWorkspace(t, { savedThread = "thread-saved", storageBlocked = false, historyFetch = async () => Response.json({ threads: [] }), threadFetch = async (id) => Response.json({ thread: { id, data: { cards: [], messages: [] } } }), mutationFetch = async () => { throw new Error("Unexpected mutation"); } } = {}) {
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
  const historyCalls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    if (input === "/api/dialogue" && init?.method === "POST") return mutationFetch(JSON.parse(init.body));
    if (typeof input === "string" && input.startsWith("/api/dialogue?")) {
      const id = new URL(input, "https://preview.example.invalid").searchParams.get("id");
      if (id) return threadFetch(id, init);
      historyCalls.push(input);
      return historyFetch(input, init);
    }
    throw new Error("Unexpected external request in UI test");
  });
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
    onSaved() {},
    onSchedule() {},
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
    "./dialogue-module-theme.css": {},
    "./dialogue-model": loadComponent("app/dialogue-model.ts"),
    "./dialogue-result-preview": loadComponent("app/dialogue-result-preview.tsx", { react: React, "react/jsx-runtime": jsx }),
    "./dialogue-result-actions": loadComponent("app/dialogue-result-actions.tsx", { "react/jsx-runtime": jsx }),
    "./dialogue-thread-actions": loadComponent("app/dialogue-thread-actions.tsx", {
      react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM,
    }),
    "./dialogue-recent-threads": loadComponent("app/dialogue-recent-threads.tsx", {
      react: React, "react/jsx-runtime": jsx,
      "./dialogue-thread-actions": loadComponent("app/dialogue-thread-actions.tsx", {
        react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM,
      }),
    }),
    "./dialogue-settings-popover": loadComponent("app/dialogue-settings-popover.tsx", {
      react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM,
    }),
    "./dialogue-results-menu": loadComponent("app/dialogue-results-menu.tsx", {
      react: React, "react/jsx-runtime": jsx, "./dialogue-model": loadComponent("app/dialogue-model.ts"),
    }),
    "./image-lightbox": loadComponent("app/image-lightbox.tsx", {
      react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM,
    }),
    "./dialogue-generation-settings": generationSettings,
    "./dialogue-starters": loadComponent("app/dialogue-starters.ts"),
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
      async showHistory() { this.historyOpened = true; }
      async sendUserMessage(message) { this.sentMessage = message; }
      async fetchUpdates() { this.updated = true; }
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
    window, container, uncaught, calls, historyCalls, render, element, storageKey,
    remount: async () => {
      await React.act(async () => root.render(null));
      await render();
    },
    event: (name, detail) => React.act(async () => element().dispatchEvent(new window.CustomEvent(`chatkit.${name}`, { detail }))),
    define: () => React.act(async () => defineElement()),
    ready: () => React.act(async () => element().dispatchEvent(new window.CustomEvent("chatkit.ready"))),
    expire: () => React.act(async () => startupTimeout()),
    scriptError: () => React.act(async () => scriptProps.onError()),
    clickNew: () => React.act(async () => container.querySelector(".klio-chatkit-new").click()),
    chooseTool: (toolId) => React.act(async () => element().dispatchEvent(new window.CustomEvent("chatkit.tool.change", { detail: { toolId } }))),
    chooseOption: async (label, text) => {
      if (!window.document.querySelector(".klio-chatkit-settings-grid"))
        await React.act(async () => container.querySelector(".klio-chatkit-settings-toggle").click());
      const field = [...window.document.querySelectorAll(".module-select")].find((node) => node.querySelector(".field-label-help")?.textContent === label);
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
  await React.act(async () => h.window.document.querySelector(".klio-chatkit-settings-logo input").click());
  await React.act(async () => h.container.querySelector(".klio-chatkit-settings-toggle").click());
  assert.equal(h.window.document.querySelector(".klio-chatkit-settings-grid"), null);
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
  assert.equal(h.window.document.body.textContent.includes("Объём"), false);
  await h.chooseOption("Количество тем", "8");
  await submit("topics");
  assert.deepEqual(sent.at(-1).params.klio_settings, { format: "seo", topicCount: "8" });
  await h.chooseTool(null);
  assert.equal(h.container.querySelector(".klio-chatkit-settings"), null);
  await submit(null);
  assert.deepEqual(sent.at(-1).params.klio_settings, {});
  await h.chooseTool("text");
  await React.act(async () => h.container.querySelector(".klio-chatkit-settings-toggle").click());
  assert.ok(h.window.document.body.textContent.includes("Экспертный"));
  assert.ok(h.window.document.body.textContent.includes("Длинный"));
  assert.deepEqual(h.uncaught, []);
});

test("starter buttons submit the intended tool and ordinary new messages stay in chat", async (t) => {
  const h = await mountWorkspace(t, { savedThread: null });
  await h.define();
  await h.ready();
  await h.chooseTool("topics");
  await h.chooseOption("Количество тем", "8");
  await h.chooseTool(null);
  const sent = [];
  t.mock.method(globalThis, "fetch", async (request) => { sent.push(await request.json()); return new Response("{}"); });
  const submit = async (text, type = "threads.create", tool = "") => {
    await h.element().options.api.fetch(new Request("https://preview.example.invalid/api/chatkit", {
      method: "POST", body: JSON.stringify({ type, params: { input: { content: [{ type: "input_text", text }], inference_options: { tool_choice: tool ? { id: tool } : null } } } }),
    }));
    return sent.at(-1).params;
  };
  const [topics, post, idea] = h.element().options.startScreen.prompts;
  const params = await submit(topics.prompt);
  assert.equal(params.input.inference_options.tool_choice.id, "topics");
  assert.equal(params.klio_settings.topicCount, "8");
  assert.equal((await submit(post.prompt)).klio_settings.format, "social");
  for (const text of [idea.prompt, "Почему небо голубое?"]) {
    const params = await submit(text);
    assert.equal(params.input.inference_options.tool_choice, null);
    assert.deepEqual(params.klio_settings, {});
  }
  assert.equal((await submit(topics.prompt, "threads.add_user_message")).input.inference_options.tool_choice, null);
  assert.equal((await submit(topics.prompt, "threads.create", "image")).input.inference_options.tool_choice.id, "image");
});

test("topic widget actions use the full selected topic and current brand preference", async (t) => {
  const card = { id: "topic-1", kind: "topic", title: "Съёмка в студии", body: "Подробный план съёмки", imageUrl: "" };
  const h = await mountWorkspace(t, { threadFetch: async (id) => Response.json({ thread: { id, data: { cards: [card], messages: [] } } }) });
  const transfers = [];
  await h.render({ onGenerateTopic: async (source) => transfers.push(source) });
  await h.define();
  await h.ready();
  for (const [action, tool] of [["klio.topic_post", "topic-post"], ["klio.topic_article", "topic-article"], ["klio.image", "image-card:topic-1"]]) {
    await React.act(async () => h.element().options.widgets.onAction({ type: action, payload: { threadId: "thread-saved", cardId: card.id } }));
    assert.equal(h.element().sentMessage.toolChoice.id, tool);
    assert.ok(h.element().sentMessage.text.includes(card.title));
    assert.ok(h.element().sentMessage.text.includes(card.body));
  }
  await React.act(async () => h.element().options.widgets.onAction({ type: "klio.topic_generator", payload: { threadId: "thread-saved", cardId: card.id } }));
  assert.deepEqual(transfers, [{ title: card.title, body: card.body, useBrandContext: false }]);
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
  assert.equal(h.window.document.querySelector(".klio-chatkit-settings-grid"), null);
  assert.ok(h.container.querySelector(".klio-chatkit-brand-context input"));
  await React.act(async () => h.container.querySelector(".klio-chatkit-settings-toggle").click());
  assert.match(h.window.document.querySelector("button.klio-chatkit-settings-logo").textContent, /Добавить логотип/);
  await React.act(async () => h.window.document.querySelector("button.klio-chatkit-settings-logo").click());
  assert.deepEqual(navigation, ["brand"]);
  await h.render({ hasLogo: true });
  assert.equal(h.window.document.querySelector("button.klio-chatkit-settings-logo"), null);
  assert.ok(h.window.document.querySelector(".klio-chatkit-settings-logo input"));
});

test("settings float above their trigger and close outside or with Escape without breaking nested selections", async (t) => {
  const h = await mountWorkspace(t);
  await h.define();
  await h.ready();
  await h.chooseTool("image");
  const button = h.container.querySelector(".klio-chatkit-settings-toggle");
  button.getBoundingClientRect = () => ({ top: 600, bottom: 632, left: 80, width: 120 });
  await React.act(async () => button.click());
  const panel = () => h.window.document.querySelector(".klio-chatkit-settings-popover");
  assert.equal(panel().parentElement, h.window.document.body);
  assert.equal(panel().style.bottom, `${h.window.innerHeight - 600 + 8}px`);
  assert.equal(panel().style.maxHeight, "420px");
  await React.act(async () => panel().querySelector(".module-select-trigger").click());
  const option = h.window.document.querySelector('[role="option"]');
  await React.act(async () => option.dispatchEvent(new h.window.PointerEvent("pointerdown", { bubbles: true })));
  assert.ok(panel(), "nested dropdown is part of settings");
  await React.act(async () => h.window.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape" })));
  assert.ok(panel(), "first Escape closes only the nested dropdown");
  assert.equal(h.window.document.querySelector('[role="listbox"]'), null);
  await React.act(async () => h.window.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape" })));
  assert.equal(panel(), null);
  assert.equal(h.window.document.activeElement, button);
  await React.act(async () => button.click());
  await React.act(async () => h.window.document.body.dispatchEvent(new h.window.PointerEvent("pointerdown", { bubbles: true })));
  assert.equal(panel(), null);
});

test("sidebar retains earlier chats when starting a new one and restores them after remount", async (t) => {
  let threads = [{ id: "thread-saved", title: "Первый разговор", status: "idle" }];
  const h = await mountWorkspace(t, { historyFetch: async () => Response.json({ threads }) });
  assert.equal(h.historyCalls.length, 0, "wait for ChatKit readiness");
  await h.define();
  await h.ready();
  const sidebar = () => h.container.querySelector(".klio-chatkit-recent");
  const current = () => sidebar().querySelector('[aria-current="page"]');
  assert.match(current().textContent, /Первый разговор/);
  await h.clickNew();
  assert.equal(current(), null);
  assert.match(sidebar().textContent, /Первый разговор/);

  threads = [{ id: "second", title: "Новый диалог", status: "processing" }, ...threads];
  await h.event("thread.change", { threadId: "second" });
  assert.match(current().textContent, /Новый диалог/);
  threads[0] = { ...threads[0], title: "Картинка для студии", status: "idle" };
  await h.event("response.end");
  assert.match(current().textContent, /Картинка для студии/);
  assert.equal(sidebar().querySelector(".klio-chatkit-recent-busy"), null);

  await React.act(async () => [...sidebar().querySelectorAll("li button")].find((node) => node.textContent.includes("Первый разговор")).click());
  assert.equal(h.calls.at(-1), "thread-saved");
  assert.equal(h.window.localStorage.getItem(h.storageKey), "thread-saved");
  await h.remount();
  await h.ready();
  assert.equal(sidebar().querySelectorAll("li").length, 2);
  assert.match(current().textContent, /Первый разговор/);
  await React.act(async () => sidebar().querySelector(".klio-chatkit-all-history").click());
  assert.equal(h.element().historyOpened, true);
  threads[1] = { ...threads[1], title: "Переименованный разговор" };
  await h.event("history.close");
  assert.match(current().textContent, /Переименованный разговор/);
});

test("a failed history refresh preserves existing chats and can be retried", async (t) => {
  let fail = false;
  const h = await mountWorkspace(t, { historyFetch: async () => fail
    ? new Response("Unavailable", { status: 503 })
    : Response.json({ threads: [{ id: "thread-saved", title: "Сохранённый разговор", status: "idle" }] }) });
  await h.define();
  await h.ready();
  fail = true;
  await h.event("response.end");
  assert.match(h.container.querySelector(".klio-chatkit-recent").textContent, /Сохранённый разговор/);
  assert.ok(h.container.querySelector(".klio-chatkit-recent-error"));
  fail = false;
  await React.act(async () => h.container.querySelector(".klio-chatkit-recent-error button").click());
  assert.equal(h.container.querySelector(".klio-chatkit-recent-error"), null);
  assert.deepEqual(h.uncaught, []);
});

test("sidebar rename and confirmed deletion update history and clear only the deleted active selection", async (t) => {
  let threads = [{ id: "thread-saved", title: "Первый диалог", status: "idle", revision: 7 }, { id: "other", title: "Второй диалог", status: "idle", revision: 2 }];
  const changes = [];
  const h = await mountWorkspace(t, {
    historyFetch: async () => Response.json({ threads }),
    threadFetch: async (id) => Response.json({ thread: { ...threads.find((thread) => thread.id === id), data: { cards: [], messages: [] } } }),
    mutationFetch: async (body) => {
      changes.push(body);
      const thread = threads.find((thread) => thread.id === body.id);
      assert.equal(body.revision, thread.revision);
      if (body.action === "delete") { threads = threads.filter((thread) => thread.id !== body.id); return Response.json({ deletedId: body.id }); }
      thread.title = body.title; thread.revision++;
      return Response.json({ thread: { ...thread, data: { cards: [], messages: [] } } });
    },
  });
  await h.define(); await h.ready();
  assert.equal(h.element().options.history.showDelete, true);
  const dialog = () => h.window.document.querySelector(".klio-chatkit-thread-dialog");
  const open = async (index, action) => {
    await React.act(async () => h.container.querySelectorAll(".klio-chatkit-thread-more")[index].click());
    assert.equal(h.window.document.querySelector(".klio-chatkit-thread-menu").parentElement, h.window.document.body);
    await React.act(async () => h.window.document.querySelector(`.klio-chatkit-thread-menu [data-action="${action}"]`).click());
  };
  await open(0, "rename");
  const input = dialog().querySelector("input");
  assert.equal(h.window.document.activeElement, input);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype, "value").set.call(input, "  Новый заголовок  ");
    input.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  });
  await React.act(async () => dialog().querySelector('button[type="submit"]').click());
  assert.equal(dialog(), null);
  assert.equal(changes[0].title, "Новый заголовок");
  assert.ok(h.container.querySelector('[aria-current="page"]').textContent.includes("Новый заголовок"));
  assert.equal(h.element().updated, true);
  await open(1, "delete");
  assert.match(dialog().textContent, /Материалах/);
  assert.equal(h.window.document.activeElement.textContent, "Отмена");
  await React.act(async () => dialog().querySelector('button[type="button"]').click());
  assert.equal(changes.length, 1, "cancelling must not send a deletion");
  await open(1, "delete");
  await React.act(async () => dialog().querySelector('button[type="submit"]').click());
  assert.equal(h.window.localStorage.getItem(h.storageKey), "thread-saved");
  assert.equal(h.container.querySelectorAll(".klio-chatkit-recent li").length, 1);
  await open(0, "delete");
  await React.act(async () => dialog().querySelector('button[type="submit"]').click());
  assert.equal(h.window.localStorage.getItem(h.storageKey), null);
  assert.equal(h.calls.at(-1), null);
  assert.equal(h.container.querySelector('[aria-current="page"]'), null);
  assert.equal(h.container.querySelectorAll(".klio-chatkit-recent li").length, 0);
  assert.deepEqual(h.uncaught, []);
});

test("failed deletion keeps the confirmation and selected thread intact", async (t) => {
  const thread = { id: "thread-saved", title: "Важный диалог", status: "idle", revision: 5, data: { cards: [], messages: [] } };
  const h = await mountWorkspace(t, {
    historyFetch: async () => Response.json({ threads: [thread] }), threadFetch: async () => Response.json({ thread }),
    mutationFetch: async () => Response.json({ error: "Диалог изменён в другой вкладке" }, { status: 409 }),
  });
  await h.define(); await h.ready();
  await React.act(async () => h.container.querySelector(".klio-chatkit-thread-more").click());
  await React.act(async () => h.window.document.querySelector('.klio-chatkit-thread-menu [data-action="delete"]').click());
  await React.act(async () => h.window.document.querySelector('.klio-chatkit-thread-dialog button[type="submit"]').click());
  assert.match(h.window.document.querySelector('.klio-chatkit-thread-dialog [role="alert"]').textContent, /другой вкладке/);
  assert.equal(h.window.localStorage.getItem(h.storageKey), "thread-saved");
  assert.equal(h.container.querySelectorAll(".klio-chatkit-recent li").length, 1);
  await React.act(async () => h.window.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(h.window.document.querySelector(".klio-chatkit-thread-dialog"), null);
});

test("late history from the previous brand cannot replace the selected brand's chats", async (t) => {
  let resolveOld;
  const h = await mountWorkspace(t, { historyFetch: (input) => {
    const brand = new URL(input, "https://preview.example.invalid").searchParams.get("brandId");
    if (!brand) return new Promise((resolve) => { resolveOld = resolve; });
    return Response.json({ threads: [{ id: "brand-chat", title: "Диалог второго бизнеса", status: "idle" }] });
  } });
  await h.define();
  await h.ready();
  await h.render({ brandId: "brand-2" });
  await h.ready();
  assert.match(h.container.querySelector(".klio-chatkit-recent").textContent, /Диалог второго бизнеса/);
  await React.act(async () => resolveOld(Response.json({ threads: [{ id: "old", title: "Чужой список", status: "idle" }] })));
  assert.equal(h.container.querySelector(".klio-chatkit-recent").textContent.includes("Чужой список"), false);
  assert.ok(h.historyCalls.some((url) => url.includes("brandId=brand-2")));
});

test("results menu opens complete topics and images from the current thread without searching the chat", async (t) => {
  const topic = { id: "topic", kind: "topic", title: "Съёмочный процесс", body: "Подробное описание идеи. ".repeat(100), imageUrl: "", versions: [] };
  const image = { id: "image", kind: "post", title: "Студия", body: "", imageUrl: "https://cdn.example.invalid/studio.png", versions: [] };
  let cards = [topic];
  const h = await mountWorkspace(t, { threadFetch: async (id) => Response.json({ thread: { id, data: { cards: id === "thread-saved" ? cards : [], messages: [] } } }) });
  await h.define();
  await h.ready();
  assert.equal(h.element().options.header.enabled, false);
  assert.match(h.container.querySelector(".klio-chatkit-results-trigger").textContent, /Результаты1/);
  cards = [topic, image];
  await h.event("response.end");
  assert.match(h.container.querySelector(".klio-chatkit-results-trigger").textContent, /Результаты2/);
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-trigger").click());
  assert.match(h.container.querySelector(".klio-chatkit-results-list").textContent, /ТемаСъёмочный процесс/);
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-list button").click());
  assert.equal(h.container.querySelector(".klio-chatkit-result-body").textContent, topic.body);
  assert.equal(h.container.querySelector(".klio-chatkit-editor textarea"), null, "viewing must not start an edit");
  assert.equal(h.container.querySelector(".klio-chatkit-results-list"), null);
  await React.act(async () => h.container.querySelector(".klio-chatkit-editor header button").click());
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-trigger").click());
  await React.act(async () => h.container.querySelectorAll(".klio-chatkit-results-list button")[1].click());
  assert.equal(h.window.document.querySelector(".image-lightbox-image").src, image.imageUrl);
  await React.act(async () => h.window.document.querySelector(".image-lightbox-close").click());
  await h.clickNew();
  assert.equal(h.container.querySelector(".klio-chatkit-results-trigger"), null);
  await h.event("thread.change", { threadId: "other" });
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-trigger").click());
  assert.equal(h.container.querySelectorAll(".klio-chatkit-results-list button").length, 0);
  assert.equal(h.container.querySelector(".klio-chatkit-results-list").textContent.includes(topic.title), false);
  await React.act(async () => h.container.querySelector(".klio-chatkit-history-button").click());
  assert.equal(h.element().historyOpened, true);
});

test("image result preview downloads locally and opens a publication draft without the old prompt caption", async (t) => {
  const prompt = "Картинка творческого процесса в студии";
  const key = `publications/${"a".repeat(64)}/00000000-0000-0000-0000-000000000001.png`;
  const card = { id: "image-card", kind: "post", title: prompt, body: prompt, imageUrl: `https://main.example.invalid/api/uploads/${key}`, savedId: "saved-image", versions: [] };
  const thread = { id: "thread-saved", revision: 7, data: { cards: [card], messages: [
    { role: "user", text: prompt },
    { role: "assistant", text: "Изображение готово и сохранено в материалы. Можно сразу подготовить публикацию или доработать карточку.", cardIds: [card.id] },
  ] } };
  const mutations = [], scheduled = [];
  const h = await mountWorkspace(t, {
    threadFetch: async () => Response.json({ thread }),
    mutationFetch: async (body) => { mutations.push(body); return Response.json({ thread, generation: { id: card.savedId, title: prompt, body: prompt, imageUrl: card.imageUrl } }); },
  });
  await h.render({ onSchedule: (value) => scheduled.push(value) });
  await h.define(); await h.ready();
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-trigger").click());
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-list button").click());
  const overlay = h.window.document.querySelector(".image-lightbox-overlay");
  assert.ok(overlay);
  assert.equal(overlay.querySelector("a[download]").getAttribute("href"), `/api/uploads/${key}?download=1`);
  assert.equal(overlay.querySelector('[data-action="klio.save"]').disabled, true);
  assert.equal(overlay.querySelector('[data-action="klio.edit"]'), null);
  const publish = overlay.querySelector('[data-action="klio.publish"]');
  await React.act(async () => {
    overlay.querySelector(".image-lightbox-close").focus();
    h.window.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
  });
  assert.equal(h.window.document.activeElement, publish, "keyboard users can reach preview actions");
  await React.act(async () => publish.click());
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].action, "save", "preview only prepares a draft; it must not publish externally");
  assert.equal(mutations[0].cardId, card.id);
  assert.equal(mutations[0].revision, 7);
  assert.deepEqual(scheduled, [{ generationId: card.savedId, title: "", body: "", imageUrl: card.imageUrl }]);
  assert.equal(h.window.document.querySelector(".image-lightbox-overlay"), null);
  assert.deepEqual(h.uncaught, []);
});

test("failed preview save stays visible for retry and then updates its saved state", async (t) => {
  const card = { id: "post-card", kind: "post", title: "Полезный пост", body: "Полный текст", imageUrl: "", versions: [] };
  const thread = { id: "thread-saved", revision: 2, data: { cards: [card], messages: [] } };
  let fail = true;
  const h = await mountWorkspace(t, {
    threadFetch: async () => Response.json({ thread }),
    mutationFetch: async () => {
      if (fail) return Response.json({ error: "Не удалось сохранить. Повторите попытку." }, { status: 503 });
      card.savedId = "saved-post";
      return Response.json({ thread, generation: { id: card.savedId, title: card.title, body: card.body } });
    },
  });
  await h.define(); await h.ready();
  await React.act(async () => h.element().options.widgets.onAction({ type: "klio.view_result", payload: { threadId: thread.id, cardId: card.id } }));
  const preview = () => h.container.querySelector(".klio-chatkit-result-preview");
  await React.act(async () => preview().querySelector('[data-action="klio.save"]').click());
  assert.match(preview().querySelector('[role="alert"]').textContent, /Повторите попытку/);
  assert.equal(preview().querySelector('[data-action="klio.save"]').disabled, false);
  fail = false;
  await React.act(async () => preview().querySelector('[data-action="klio.save"]').click());
  assert.equal(preview().querySelector('[role="alert"]'), null);
  assert.equal(preview().querySelector('[data-action="klio.save"]').disabled, true);
  assert.match(preview().querySelector('[role="status"]').textContent, /Сохранено/);
  assert.equal(preview().querySelector(".klio-chatkit-result-body").textContent, card.body);
  assert.deepEqual(h.uncaught, []);
});

test("topic result preview starts a post from that topic without searching the chat", async (t) => {
  const card = { id: "topic-12", kind: "topic", title: "За кадром", body: "Работа оператора и режиссёра", imageUrl: "", versions: [] };
  const thread = { id: "thread-saved", data: { cards: [card], messages: [] } };
  const h = await mountWorkspace(t, { threadFetch: async () => Response.json({ thread }) });
  await h.define(); await h.ready();
  await React.act(async () => h.element().options.widgets.onAction({ type: "klio.view_result", payload: { threadId: thread.id, cardId: card.id } }));
  const preview = h.container.querySelector(".klio-chatkit-result-preview");
  for (const action of ["klio.topic_post", "klio.topic_article", "klio.topic_generator", "klio.image", "klio.edit"]) assert.ok(preview.querySelector(`[data-action="${action}"]`));
  await React.act(async () => preview.querySelector('[data-action="klio.topic_post"]').click());
  assert.equal(h.element().sentMessage.toolChoice.id, "topic-post");
  assert.ok(h.element().sentMessage.text.includes(card.title));
  assert.ok(h.element().sentMessage.text.includes(card.body));
  assert.equal(h.container.querySelector(".klio-chatkit-result-preview"), null);
  assert.equal(card.body, "Работа оператора и режиссёра");
});

test("legacy prompt duplicates open as images; manually edited text remains readable and editable", async (t) => {
  const prompt = "Картинку к статье на тему: Творческий процесс в студии.";
  const card = { id: "legacy", kind: "post", title: prompt, body: prompt, imageUrl: "https://cdn.example.invalid/studio.png", versions: [] };
  const thread = { id: "thread-saved", data: { cards: [card], messages: [
    { role: "user", text: prompt },
    { role: "assistant", text: "Изображение готово и сохранено в материалы. Можно сразу подготовить публикацию или доработать карточку.", cardIds: [card.id] },
  ] } };
  const h = await mountWorkspace(t, { threadFetch: async () => Response.json({ thread }) });
  await h.define(); await h.ready();
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-trigger").click());
  assert.equal(h.container.querySelector(".klio-chatkit-results-list small").textContent, "Изображение");
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-list button").click());
  assert.equal(h.window.document.querySelector(".image-lightbox-image").src, card.imageUrl);
  assert.equal(h.container.querySelector(".klio-chatkit-editor"), null);
  await React.act(async () => h.window.document.querySelector(".image-lightbox-close").click());
  await React.act(async () => h.element().options.widgets.onAction({ type: "klio.open_image", payload: { threadId: thread.id, cardId: card.id } }));
  assert.equal(h.window.document.querySelector(".image-lightbox-image").src, card.imageUrl);
  assert.equal(h.window.document.activeElement, h.window.document.querySelector(".image-lightbox-close"));
  await React.act(async () => h.window.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape" })));
  assert.equal(h.window.document.querySelector(".image-lightbox-image"), null);

  card.body = "Отредактированный пользователем текст";
  await h.event("response.end");
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-trigger").click());
  assert.equal(h.container.querySelector(".klio-chatkit-results-list small").textContent, "Текст и изображение");
  await React.act(async () => h.container.querySelector(".klio-chatkit-results-list button").click());
  assert.equal(h.container.querySelector(".klio-chatkit-result-body").textContent, card.body);
  assert.equal(h.container.querySelector("textarea"), null);
  assert.equal(h.container.querySelector(".klio-chatkit-result-image img").src, card.imageUrl);
  await React.act(async () => h.container.querySelector(".klio-chatkit-result-preview footer button:last-child").click());
  assert.equal(h.container.querySelector(".klio-chatkit-editor textarea").value, card.body);
  assert.deepEqual(h.uncaught, []);
});
