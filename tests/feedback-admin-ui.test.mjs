import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

test("admin deletion confirms, preserves failed replies, and removes successful replies across conversation switches", async t => {
  const window = new Window({ url: "https://klio.example/admin" });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const calls = [];
  let confirmed = false, fails = false;
  window.confirm = () => confirmed;
  saved.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/admin/feedback"); assert.equal(init.method, "DELETE");
    calls.push(JSON.parse(init.body));
    return fails ? Response.json({ error: "Try again" }, { status: 502 }) : Response.json({ deletedId: calls.at(-1).id });
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/admin/admin-feedback-table.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  Function("require", "exports", code)(name => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsx;
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
  await React.act(async () => root.render(React.createElement(exports.AdminFeedbackTable, { rows, accounts })));
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
});
