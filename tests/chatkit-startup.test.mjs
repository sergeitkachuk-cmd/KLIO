import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as sdk from "@openai/chatkit-react";
import ts from "typescript";

// Exercise the real React SDK with its element initially undefined, just as
// it is while the external ChatKit script is still downloading or blocked.
async function mountWorkspace(t, { savedThread = "thread-saved", storageBlocked = false } = {}) {
  const window = new Window({ url: "https://preview.example.invalid" });
  const previous = new Map();
  for (const name of ["window", "document", "customElements", "localStorage", "AbortController"]) {
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
