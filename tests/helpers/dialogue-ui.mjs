import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

export function sampleThread(id = "saved", extra = {}) {
  return { id, brandId: null, title: "Сохранённый диалог", revision: 1, status: "ready", error: "", updatedAt: new Date().toISOString(), data: { cards: [], messages: [{ id: "u", role: "user", text: "Привет" }, { id: "a", role: "assistant", text: "Здравствуйте!" }] }, ...extra };
}
export async function mountDialogue(t, { threads = [], selected = null, overrides = {}, fetchOverride, blockedStorage = false } = {}) {
  const window = new Window({ url: "https://preview.example.invalid" });
  const saved = new Map();
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "Element", "Node", "Event", "MutationObserver", "ResizeObserver", "IntersectionObserver", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "CSS", "localStorage"]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === "window" ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, value: ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"].includes(name) ? value.bind(window) : value });
  }
  saved.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [], usages = [], published = [], generated = [], navigated = [], profiled = [];
  const records = new Map(threads.map((row) => [row.id, structuredClone(row)]));
  const storageKey = `klio-chatkit:test-user:${overrides.brandId || "personal"}`;
  if (selected) window.localStorage.setItem(storageKey, selected);
  if (blockedStorage) Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Denied"); } });
  const sdk = await import("@assistant-ui/react");
  const markdown = await import("@assistant-ui/react-markdown");
  const icons = await import("lucide-react");
  const externals = { react: React, "react-dom": ReactDOM, "react/jsx-runtime": jsx, "@assistant-ui/react": sdk, "@assistant-ui/react-markdown": markdown, "lucide-react": icons };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const out = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {}; cache.set(path, exports);
    new Function("require", "exports", out)((name) => {
      if (name.endsWith(".css")) { assert.ok(existsSync(resolve(dirname(path), name)), `Missing stylesheet ${name}`); return {}; }
      if (name in externals) return externals[name];
      assert.ok(name.startsWith("."), `Unexpected dependency ${name}`);
      const base = resolve(dirname(path), name);
      const target = [base + ".tsx", base + ".ts"].find(existsSync);
      assert.ok(target, `Missing module ${name}`); return load(target);
    }, exports);
    return exports;
  }
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (url === "/api/uploads") {
      calls.push({ upload: true });
      const response = fetchOverride && await fetchOverride(url, init, null, records);
      assert.ok(response, "Unexpected upload without a test handler");
      return response;
    }
    assert.ok(typeof url === "string" && url.startsWith("/api/dialogue"), `Unexpected external request: ${url}`);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push(body || url);
    if (fetchOverride) { const result = await fetchOverride(url, init, body, records); if (result) return result; }
    if (!body) {
      const query = new URL(url, window.location.href).searchParams;
      if (query.has("id")) return records.has(query.get("id")) ? Response.json({ thread: records.get(query.get("id")) }) : Response.json({ error: "Диалог не найден" }, { status: 404 });
      return Response.json({ threads: [...records.values()].filter((row) => (row.brandId || "") === (query.get("brandId") || "")), next: null });
    }
    if (body.action === "create") { const row = sampleThread(body.id, { brandId: body.brandId || null, revision: 0, data: { cards: [], messages: [] } }); records.set(row.id, row); return Response.json({ thread: row }); }
    const row = records.get(body.id); assert.ok(row);
    if (body.action === "delete") { records.delete(body.id); return Response.json({ deletedId: body.id }); }
    row.revision++;
    if (body.action === "rename") row.title = body.title;
    if (body.action === "edit") Object.assign(row.data.cards.find((card) => card.id === body.cardId), { title: body.title, body: body.body });
    if (body.action === "send") row.data.messages.push({ id: body.requestId, role: "user", text: body.text }, { id: `a-${body.requestId}`, role: "assistant", text: "Тестовый ответ" });
    if (body.action === "save") {
      const card = row.data.cards.find((card) => card.id === body.cardId);
      card.savedId = "material-1"; card.savedSnapshot = { title: card.title, body: card.body, imageUrl: card.imageUrl };
      return Response.json({ thread: row, generation: { id: card.savedId, title: card.title, body: card.body, imageUrl: card.imageUrl, brandId: row.brandId } });
    }
    return Response.json({ thread: row });
  });
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container);
  const errors = [];
  const root = createRoot(container, { onUncaughtError: (error) => errors.push(error) });
  const { DialogueWorkspace } = load(fileURLToPath(new URL("../../app/dialogue-workspace.tsx", import.meta.url)));
  let props = { userKey: "test-user", brandId: "", brandName: "", brands: [], theme: "light", visible: true, hasLogo: false,
    beforeProfile: async () => true, onUsage: () => usages.push(true), onSaved: () => {}, onSchedule: (value) => published.push(value), onGenerateTopic: (value) => generated.push(value), onNavigate: (value) => navigated.push(value), onBrandChange: () => {}, onProfile: (value) => profiled.push(value), onProfessional: () => {}, importMaterial: null, ...overrides };
  async function render(changes = {}) {
    props = { ...props, ...changes }; document.documentElement.dataset.theme = props.theme;
    await React.act(async () => root.render(React.createElement("div", { className: "workspace-shell is-dialogue" }, React.createElement(DialogueWorkspace, props))));
    assert.equal(errors.length, 0, errors.map(String).join("\n"));
  }
  const click = async (element) => { assert.ok(element, "Missing element to click"); await React.act(async () => element.click()); assert.equal(errors.length, 0, errors.map(String).join("\n")); };
  const findButton = (label, scope = document) => [...scope.querySelectorAll("button")].find((button) => button.textContent.trim() === label || button.getAttribute("aria-label") === label);
  async function type(value, element = document.querySelector("textarea.klio-aui-input")) {
    assert.ok(element, "Missing input");
    await React.act(async () => {
      const proto = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
      element.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }
  t.after(async () => {
    await React.act(async () => root.unmount()); await window.happyDOM.abort();
    for (const [name, value] of saved) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; }
  });
  await render();
  return { window, document, render, click, findButton, type, calls, records, published, generated, navigated, profiled, errors, container };
}
