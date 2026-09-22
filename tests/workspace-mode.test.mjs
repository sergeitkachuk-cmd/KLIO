import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual handler, with deferred network/storage dependencies.
const source = ts.createSourceFile("workspace.tsx", readFileSync(new URL("../app/textora-experience.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "changeWorkspaceMode") handler = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
const code = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup({ brand = "brand-1", mode = "professional", busy = false } = {}) {
  let finishPreference, finishProfile;
  const preference = new Promise(resolve => { finishPreference = resolve; });
  const profile = new Promise(resolve => { finishProfile = resolve; });
  const state = { mode, busy, module: "generator", saves: 0, requests: [], toasts: [], draft: "" };
  const context = vm.createContext({
    modeSaving: busy, workspaceMode: mode, activeBrandId: brand, AbortSignal,
    setModeSaving: value => { state.busy = value; },
    setWorkspaceMode: value => { state.mode = value; },
    openModule: value => { state.module = value; },
    saveActiveWorkspaceBrand: () => { state.saves++; return profile; },
    fetch: (url, init) => { state.requests.push({ url, body: JSON.parse(init.body) }); return preference; },
    safeJson: response => response.json(),
    showToast: message => state.toasts.push(message),
  });
  vm.runInContext(code, context);
  return { state, switchMode: context.changeWorkspaceMode, finishPreference, finishProfile };
}

test("dialogue opens before slow profile and mode saves complete", async () => {
  const app = setup();
  assert.equal(await app.switchMode("dialogue"), true);
  assert.equal(app.state.mode, "dialogue");
  assert.equal(app.state.module, "start");
  assert.equal(app.state.saves, 1);
  assert.equal(app.state.requests[0].body.mode, "dialogue");
  assert.equal(app.state.busy, true);
  app.finishPreference(Response.json({ mode: "dialogue" }));
  await flush();
  assert.equal(app.state.busy, false, "profile save must not block the mode controls");
  app.finishProfile(true);
});

test("failed preference save keeps the open dialogue and draft, and reports the failure", async () => {
  const app = setup({ brand: "" });
  await app.switchMode("dialogue");
  app.state.draft = "Already typing a message";
  app.finishPreference(Response.json({ error: "offline" }, { status: 503 }));
  await flush();
  assert.equal(app.state.mode, "dialogue");
  assert.equal(app.state.draft, "Already typing a message");
  assert.equal(app.state.saves, 0);
  assert.equal(app.state.busy, false);
  assert.equal(app.state.toasts.length, 1);
});

test("professional mode preserves the selected module and skips redundant requests", async () => {
  const same = setup();
  assert.equal(await same.switchMode("professional"), true);
  assert.equal(same.state.requests.length, 0);
  const busy = setup({ busy: true });
  assert.equal(await busy.switchMode("dialogue"), false);
  assert.equal(busy.state.requests.length, 0);
  const app = setup({ mode: "dialogue", brand: "" });
  assert.equal(await app.switchMode("professional"), true);
  assert.equal(app.state.mode, "professional");
  assert.equal(app.state.module, "generator");
  app.finishPreference(Response.json({ mode: "professional" }));
  await flush();
});
