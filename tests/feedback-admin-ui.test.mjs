import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

test("admin conversations refresh Telegram replies and deletions without losing drafts or deletion controls", async t => {
  const window = new Window({ url: "https://klio.example/admin" });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const calls = [];
  const timers = new Map();
  let timerId = 0, reads = 0, serverRows = [];
  window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  let confirmed = false, fails = false;
  window.confirm = () => confirmed;
  saved.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/admin/feedback");
    if (!init.method) { reads++; return Response.json({ messages: serverRows }); }
    assert.equal(init.method, "DELETE");
    calls.push(JSON.parse(init.body));
    if (!fails) serverRows = serverRows.filter(row => row.id !== calls.at(-1).id);
    return fails ? Response.json({ error: "Try again" }, { status: 502 }) : Response.json({ deletedId: calls.at(-1).id });
  };
  const sync = {};
  Function("exports", ts.transpileModule(readFileSync(new URL("../app/feedback-sync.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(sync);
  const code = ts.transpileModule(readFileSync(new URL("../app/admin/admin-feedback-table.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  Function("require", "exports", code)(name => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "../feedback-sync") return sync;
    throw new Error(name);
  }, exports);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(window.document.body.appendChild(window.document.createElement("div")));
  t.after(async () => {
    await React.act(async () => root.unmount()); await window.happyDOM.abort();
    for (const [key, value] of saved) {
      if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key];
    }
  });
  const rows = [
    { id: "reply", ownerEmail: "first@example.invalid", sender: "admin", body: "Duplicate reply", createdAt: "2026-11-03T10:00:00Z", readAt: null },
    { id: "question", ownerEmail: "first@example.invalid", sender: "client", body: "Client question", createdAt: "2026-11-03T09:00:00Z", readAt: null },
    { id: "other", ownerEmail: "second@example.invalid", sender: "client", body: "Another question", createdAt: "2026-11-02T09:00:00Z", readAt: null },
  ];
  const accounts = [{ email: "first@example.invalid", displayName: "First", avatarUrl: null }, { email: "second@example.invalid", displayName: "Second", avatarUrl: null }];
  serverRows = rows.slice();
  await React.act(async () => root.render(React.createElement(exports.AdminFeedbackTable, { rows, accounts })));
  assert.ok(reads > 0, "The rendered admin conversation must fetch updates");
  const document = window.document;
  const remove = () => document.querySelector(".admin-feedback-message-delete");
  const click = async element => { assert.ok(element); await React.act(async () => element.click()); };
  assert.equal(document.querySelectorAll(".admin-feedback-message-delete").length, 1);
  await click(remove()); assert.equal(calls.length, 0);
  confirmed = true; fails = true;
  await click(remove());
  assert.equal(document.querySelector("[role=alert]").textContent, "Try again");
  assert.ok(remove());
  fails = false; await click(remove());
  assert.deepEqual(calls.at(-1), { id: "reply", ownerEmail: "first@example.invalid" });
  assert.equal(remove(), null);
  assert.equal(document.body.textContent.includes("Duplicate reply"), false);
  assert.ok(document.body.textContent.includes("Client question"));
  const contact = name => [...document.querySelectorAll(".admin-feedback-thread-item")].find(button => button.textContent.includes(name));
  await click(contact("Second")); await click(contact("First"));
  assert.equal(remove(), null);
  assert.equal(document.body.textContent.includes("Duplicate reply"), false);
  const input = document.querySelector("textarea");
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(input, "Unsent draft");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  async function poll() {
    const timer = [...timers].find(([, value]) => value.delay === 3000);
    assert.ok(timer, "An admin refresh must be scheduled");
    timers.delete(timer[0]);
    await React.act(async () => { timer[1].callback(); await new Promise(resolve => setImmediate(resolve)); });
  }
  serverRows.push({ ...rows[0], id: "telegram", body: "Reply from Telegram", createdAt: "2026-11-03T11:00:00Z" });
  await poll();
  assert.ok(document.querySelector(".admin-feedback-bubbles").textContent.includes("Reply from Telegram"));
  assert.equal(document.querySelector("textarea").value, "Unsent draft");
  serverRows.push({ ...rows[2], id: "elsewhere", body: "New question elsewhere", createdAt: "2026-11-03T12:00:00Z" });
  await poll();
  assert.ok(document.querySelector(".admin-feedback-thread-identity").textContent.includes("first@example.invalid"));
  assert.equal(document.querySelector("textarea").value, "Unsent draft");
  serverRows = serverRows.filter(row => row.id !== "telegram");
  await poll();
  assert.equal(document.body.textContent.includes("Reply from Telegram"), false);
  assert.equal(document.querySelector("textarea").value, "Unsent draft");
});
