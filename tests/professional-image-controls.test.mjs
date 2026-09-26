import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

// Run the real professional submit handler without credentials or paid requests.
const source = ts.createSourceFile("workspace.tsx", readFileSync(new URL("../app/textora-experience.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = {};
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["generateProfessionalImage", "startFreshImage"].includes(node.name?.text || "")) handlers[node.name.text] = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handlers.generateProfessionalImage);
assert.ok(handlers.startFreshImage);
const code = Object.values(handlers).map(handler => ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText).join("\n");
function setup(overrides = {}) {
  const state = { requests: [], error: overrides.startingError || "", busy: false, result: overrides.imageResult || null, module: "", history: [], reset: {} };
  const setResetValue = key => value => { state.reset[key] = value; };
  const context = vm.createContext({
    imageEditSourceId: null, imageReferenceSourceId: "", imageReferenceUrl: "", imageReferencePurpose: "edit", imageStyle: "",
    imageEditMask: "",
    imageResult: overrides.imageResult || null,
    imagePrompt: "Съёмочная команда в студии", imageBusy: false,
    imageTextMode: "custom", imageText: "  За кадром  ", imageSourceTitle: "Статья",
    pendingCarouselSource: { generationId: "material-1" },
    useBrand: true, activeBrandId: "studio", brand: { logoKey: "logo" }, useLogoInImage: true,
    imageAspectRatio: "9:16", imageOutputFormat: "png", logoPlacement: "corner", logoPosition: "top-left",
    setImageGeneratorMode: setResetValue("mode"), setImagePrompt: setResetValue("prompt"), setImageSourceTitle: setResetValue("sourceTitle"),
    setImageEditSourceId: setResetValue("editSourceId"), setImageReferenceUrl: setResetValue("referenceUrl"), setImageReferenceSourceId: setResetValue("referenceSourceId"),
    setImageReferencePurpose: setResetValue("referencePurpose"), setImageEditMask: setResetValue("mask"), setImageReferenceError: setResetValue("referenceError"),
    setCarouselError: setResetValue("carouselError"), setCarouselResult: setResetValue("carouselResult"), setPendingCarouselSource: setResetValue("carouselSource"),
    setImageBusy: value => { state.busy = value; }, setImageError: value => { state.error = value; }, setImageStreamPreview: setResetValue("streamPreview"),
    setImageResult: value => { state.result = value; }, setWorkspaceAccount: () => {},
    setWorkspaceHistory: updater => { state.history = updater(state.history); }, openModule: value => { state.module = value; },
    crypto: { randomUUID }, safeJson: response => response.json(),
    fetch: async (url, init) => { state.requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ generation: { id: "new-image", imageUrl: "/image.png" }, account: {} }); },
    ...overrides,
  });
  vm.runInContext(code, context);
  return { state, send: context.generateProfessionalImage, startFresh: context.startFreshImage };
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

test("switching from edit to create clears the edit source, mask, prompts, and errors", () => {
  const app = setup({ startingError: "Ошибка доработки", imageResult: { id: "old-image", imageUrl: "/old.png" } });
  app.startFresh();
  assert.deepEqual(app.state.reset, {
    mode: "create", prompt: "", sourceTitle: "", editSourceId: null, referenceUrl: "",
    referenceSourceId: "", referencePurpose: "edit", mask: "", referenceError: "",
    carouselError: "", streamPreview: "", carouselResult: null, carouselSource: null,
  });
  assert.equal(app.state.error, "");
  assert.equal(app.state.result, null);
});

test("a failed saved-image edit keeps the original image available for retry", async () => {
  const original = { id: "source-image", imageUrl: "/source.png" };
  const app = setup({ imageEditSourceId: original.id, imageResult: original, fetch: async () => Response.json({ error: "relay update needed" }, { status: 502 }) });
  await app.send();
  assert.equal(app.state.result, original);
  assert.match(app.state.error, /relay update needed/);
});

test("the editor submits its current brush mask with the selected saved source", async () => {
  const source = { id: "source-image", imageUrl: "/source.png" };
  const app = setup({ imageEditSourceId: source.id, imageEditMask: "transparent-mask-base64", imageResult: source });
  await app.send();
  const payload = app.state.requests[0].body;
  assert.equal(payload.sourceImageGenerationId, source.id);
  assert.equal(payload.sourceImagePurpose, "edit");
  assert.equal(payload.imageEditMask, "transparent-mask-base64");
});
