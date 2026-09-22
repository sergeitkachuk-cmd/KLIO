import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

// Run the real professional submit handler without credentials or paid requests.
const source = ts.createSourceFile("workspace.tsx", readFileSync(new URL("../app/textora-experience.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "generateProfessionalImage") handler = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
const code = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(overrides = {}) {
  const state = { requests: [], error: "", busy: false, result: null, module: "", history: [] };
  const context = vm.createContext({
    imagePrompt: "Съёмочная команда в студии", imageBusy: false,
    imageTextMode: "custom", imageText: "  За кадром  ", imageSourceTitle: "Статья",
    pendingCarouselSource: { generationId: "material-1" },
    useBrand: true, activeBrandId: "studio", brand: { logoKey: "logo" }, useLogoInImage: true,
    imageAspectRatio: "9:16", imageOutputFormat: "png", logoPlacement: "corner", logoPosition: "top-left",
    setImageBusy: value => { state.busy = value; }, setImageError: value => { state.error = value; },
    setImageResult: value => { state.result = value; }, setCarouselResult: () => {}, setWorkspaceAccount: () => {},
    setWorkspaceHistory: updater => { state.history = updater(state.history); }, openModule: value => { state.module = value; },
    crypto: { randomUUID }, safeJson: response => response.json(),
    fetch: async (url, init) => { state.requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ generation: { id: "new-image", imageUrl: "/image.png" }, account: {} }); },
    ...overrides,
  });
  vm.runInContext(code, context);
  return { state, send: context.generateProfessionalImage };
}
test("professional submit sends visible composition choices and source identity, then shows the saved image", async () => {
  const app = setup(); await app.send();
  assert.equal(app.state.requests.length, 1);
  assert.equal(app.state.requests[0].url, "/api/images");
  const payload = app.state.requests[0].body;
  assert.equal(payload.sourceGenerationId, "material-1");
  assert.equal(payload.imageTextMode, "custom"); assert.equal(payload.imageText, "За кадром");
  assert.equal(payload.logoPlacement, "corner"); assert.equal(payload.logoPosition, "top-left");
  assert.equal(payload.aspectRatio, "9:16"); assert.equal(payload.useLogo, true);
  assert.equal(app.state.result.imageUrl, "/image.png");
  assert.equal(app.state.history.length, 1); assert.equal(app.state.busy, false); assert.equal(app.state.module, "images");
});
test("empty custom text blocks the professional request, while no-text mode omits a stale caption", async () => {
  const invalid = setup({ imageText: " " }); await invalid.send();
  assert.equal(invalid.state.requests.length, 0); assert.match(invalid.state.error, /Введите текст/);
  const noText = setup({ imageTextMode: "none" }); await noText.send();
  assert.equal(noText.state.requests[0].body.imageTextMode, "none");
  assert.equal(noText.state.requests[0].body.imageText, undefined);
});
