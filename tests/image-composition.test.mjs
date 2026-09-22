import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import * as orm from "drizzle-orm";
import { createDialogueHarness, load, imageGenerationErrors } from "./helpers/dialogue-harness.mjs";

const overlay = load("app/api/_lib/image-logo-overlay.ts", { sharp: { default: sharp } });
const promptModule = load("app/api/_lib/dialogue-image-prompt.ts");
const pixels = buffer => sharp(Buffer.from(buffer)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
async function fixtures() {
  const base = await sharp({ create: { width: 200, height: 120, channels: 4, background: { r: 31, g: 82, b: 146, alpha: 1 } } }).png().toBuffer();
  const logo = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 240, g: 30, b: 60, alpha: 1 } } })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return { base, logo: { bytes: new Uint8Array(logo), contentType: "image/png" } };
}

test("transparent logo overlay preserves every pixel outside its corner, dimensions, colours and opacity", async () => {
  const { base, logo } = await fixtures();
  for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    const result = await overlay.overlayImageLogo(base, logo, position, "png");
    const { data, info } = await pixels(result.bytes);
    assert.equal(info.width, 200); assert.equal(info.height, 120);
    let changed = 0, realColour = 0;
    for (let y = 0; y < 120; y++) for (let x = 0; x < 200; x++) {
      const at = (y * 200 + x) * 4;
      assert.equal(data[at + 3], 255, "the photograph must not become transparent");
      if (data[at] !== 31 || data[at + 1] !== 82 || data[at + 2] !== 146) {
        changed++;
        assert.ok(position.endsWith("left") ? x < 45 : x > 155);
        assert.ok(position.startsWith("top") ? y < 25 : y > 95);
      }
      if (data[at] === 240 && data[at + 1] === 30 && data[at + 2] === 60) realColour++;
    }
    assert.ok(changed > 20); assert.ok(realColour > 20);
  }
  for (const outputFormat of ["jpeg", "webp"]) {
    const result = await overlay.overlayImageLogo(base, logo, "bottom-right", outputFormat);
    assert.equal(result.contentType, `image/${outputFormat}`);
    const metadata = await sharp(Buffer.from(result.bytes)).metadata();
    assert.equal(metadata.format, outputFormat); assert.equal(metadata.width, 200); assert.equal(metadata.height, 120);
  }
});

test("overlay does not send the logo to AI; embedded mode does; both save exactly one image", async () => {
  const { base, logo } = await fixtures();
  const calls = [], uploads = [];
  const image = load("app/api/_lib/image-generation.ts", {
    "./storage": { storageConfigured: () => true, uploadPublicationImage: async file => { uploads.push(file); return "saved"; } },
    "./image-type": load("app/api/_lib/image-type.ts"), "./image-generation-errors": imageGenerationErrors,
    "./image-logo-overlay": overlay,
  }, { FormData, fetch: async (url, options) => { calls.push({ url: String(url), body: options.body }); return Response.json({ data: [{ b64_json: base.toString("base64") }] }); } });
  await image.createImageFromLogo("Новая сцена с логотипом", logo, "owner", "https://klio.example", "overlay-test", { logoPlacement: "overlay", logoPosition: "top-left" });
  assert.match(calls[0].url, /generations$/);
  assert.match(JSON.parse(calls[0].body).prompt, /Не рисуй дополнительный логотип/);
  assert.equal(JSON.parse(calls[0].body).background, "opaque");
  assert.equal(uploads.length, 1);
  assert.notDeepEqual(Buffer.from(await uploads[0].arrayBuffer()), base);
  await image.createImageFromLogo("Новая сцена с логотипом", logo, "owner", "https://klio.example", "scene-test", { logoPlacement: "scene" });
  assert.match(calls[1].url, /edits$/);
  assert.deepEqual(Buffer.from(await calls[1].body.get("image").arrayBuffer()), Buffer.from(logo.bytes));
  assert.match(calls[1].body.get("prompt"), /Впиши его в сцену/);
  await image.createImageFromSource("Измени свет и добавь логотип", { bytes: new Uint8Array(base), contentType: "image/png" }, "edit", logo, "owner", "https://klio.example", "source-test", { logoPlacement: "overlay" });
  assert.match(calls[2].url, /edits$/);
  assert.equal(calls[2].body.getAll("image[]").length, 0);
  assert.deepEqual(Buffer.from(await calls[2].body.get("image").arrayBuffer()), base);
  assert.equal(calls[2].body.get("background"), "opaque");
  assert.equal(uploads.length, 3);
});

test("dialogue validates text before billing and preserves choices after a long brand brief", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  await h.db.insert(h.schema.brands).values({ id: "studio", ownerEmail: h.owner, name: "Студия", profileJson: JSON.stringify({ description: "Съёмочная студия. ".repeat(800), logoKey: "real" }) });
  let thread = await h.create("studio");
  const send = settings => ({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), mode: "image", text: "Творческий процесс в студии", useBrandContext: true, settings });
  for (const settings of [{ imageTextMode: "custom", imageText: " " }, { imageTextMode: "custom", imageText: "a".repeat(201) }, { imageTextMode: "title" }]) {
    assert.equal((await h.request(send(settings))).status, 400);
  }
  assert.equal((await h.account()).generationsUsed, 0); assert.equal(h.imageCalls.length, 0);
  h.setAi(async () => ({ raw: "Съёмка в студии, камера и команда." }));
  for (const imageTextMode of ["none", "custom"]) {
    await h.post(send({ imageTextMode, imageText: "Внутри студии", useLogo: true, logoPlacement: "overlay", logoPosition: "top-left" }));
    thread = await h.settled(thread.id);
    assert.equal(thread.status, "idle");
    const args = h.imageCalls.at(-1).args;
    assert.match(args[0], /Съёмка в студии, камера и команда/);
    assert.match(args[0], imageTextMode === "none" ? /Не добавляй на изображение текст/ : /Единственная новая надпись.*Внутри студии/);
    assert.match(args[0], /собственной надписи в настоящем логотипе/);
    assert.equal(args[5].logoPlacement, "overlay"); assert.equal(args[5].logoPosition, "top-left");
  }
  assert.equal((await h.account()).generationsUsed, 2);
});

test("professional images use owned material titles and the same text and logo choices", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  const calls = [], recorded = [];
  class WorkspaceAccessError extends Error { constructor(message, status) { super(message); this.status = status; } }
  await h.db.insert(h.schema.brands).values({ id: "studio", ownerEmail: h.owner, name: "Студия", profileJson: JSON.stringify({ logoKey: "real" }) });
  await h.db.insert(h.schema.generations).values({ id: "article", ownerEmail: h.owner, brandId: "studio", format: "social", topic: "Тема", title: "Настоящий заголовок", body: "Текст статьи" });
  const imageModule = load("app/api/_lib/image-generation.ts", { "./storage": {}, "./image-type": {}, "./image-generation-errors": imageGenerationErrors });
  const route = load("app/api/images/route.ts", {
    "drizzle-orm": orm, "../../../db/schema": h.schema,
    "../_lib/image-generation": { imageConfigured: () => true, parseImageGenerationOptions: imageModule.parseImageGenerationOptions, createImage: async (...args) => { calls.push({ logo: false, args }); return "image"; }, createImageFromLogo: async (...args) => { calls.push({ logo: true, args }); return "image"; } },
    "../_lib/dialogue-image-prompt": promptModule,
    "../_lib/storage": { downloadBrandLogo: async () => ({ bytes: new Uint8Array(), contentType: "image/png" }), StorageError: class extends Error {} },
    "../_lib/request-body": load("app/api/_lib/request-body.ts"),
    "../_lib/request-origin": { hasUnsafeRequestOrigin: () => false }, "../_lib/rate-limit": { isRateLimited: () => false },
    "../_lib/base-url": { resolveBaseUrl: () => "https://klio.example" },
    "../_lib/workspace-account": { workspaceIdentity: async () => ({ email: h.owner }), getWorkspaceDb: async () => h.db, assertGenerationQuotaAvailable: async () => {}, WorkspaceAccessError, workspaceErrorResponse: error => Response.json({ error: error.message }, { status: error.status }), recordGeneration: async input => { recorded.push(input); return { archive: input, account: {} }; } },
  });
  const post = extra => route.POST(new Request("https://klio.example/api/images", { method: "POST", body: JSON.stringify({ requestId: randomUUID(), prompt: "Творческий процесс в студии", brandId: "studio", ...extra }) }));
  assert.equal((await post({ imageTextMode: "custom", imageText: "" })).status, 400);
  assert.equal((await post({ imageTextMode: "title", sourceGenerationId: "foreign", sourceTitle: "Подмена" })).status, 404);
  assert.equal(calls.length, 0);
  for (const mode of ["none", "title", "custom"]) {
    const response = await post({ imageTextMode: mode, imageText: "Своя надпись", sourceGenerationId: "article", useLogo: true, logoPlacement: "overlay", logoPosition: "bottom-left", outputFormat: "webp" });
    assert.equal(response.status, 200);
    const { args, logo } = calls.at(-1); assert.equal(logo, true);
    assert.match(args[0], mode === "none" ? /Не добавляй на изображение текст/ : mode === "title" ? /Единственная новая надпись.*Настоящий заголовок/ : /Единственная новая надпись.*Своя надпись/);
    assert.ok(!args[0].includes("Подмена"));
    assert.equal(args[5].logoPlacement, "overlay"); assert.equal(args[5].logoPosition, "bottom-left"); assert.equal(args[5].outputFormat, "webp");
    assert.equal(recorded.at(-1).title, "Обложка: Настоящий заголовок");
  }
  assert.equal(recorded.length, 3);
  assert.equal((await post({ sourceGenerationId: "article", sourceTitle: "Моя ручная правка", imageTextMode: "title" })).status, 200);
  assert.match(calls.at(-1).args[0], /Единственная новая надпись.*Моя ручная правка/);
});
