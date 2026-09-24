import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import * as orm from "drizzle-orm";
import { createDialogueHarness, load, imageGenerationErrors } from "./helpers/dialogue-harness.mjs";

const promptModule = load("app/api/_lib/dialogue-image-prompt.ts");
async function fixtures() {
  const base = await sharp({ create: { width: 200, height: 120, channels: 4, background: { r: 31, g: 82, b: 146, alpha: 1 } } }).png().toBuffer();
  const logo = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 240, g: 30, b: 60, alpha: 1 } } })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return { base, logo: { bytes: new Uint8Array(logo), contentType: "image/png" } };
}

test("corner mode sends PNG and JPEG logos to AI with the caption and placement; saved pixels are never overlaid", async () => {
  const { base, logo } = await fixtures();
  const jpegLogo = { bytes: new Uint8Array(await sharp(Buffer.from(logo.bytes)).flatten({ background: "#132c52" }).jpeg().toBuffer()), contentType: "image/jpeg" };
  const calls = [], uploads = [];
  const image = load("app/api/_lib/image-generation.ts", {
    "./storage": { storageConfigured: () => true, uploadPublicationImage: async file => { uploads.push(file); return "saved"; } },
    "./image-type": load("app/api/_lib/image-type.ts"), "./image-generation-errors": imageGenerationErrors,
  }, { FormData, fetch: async (url, options) => { calls.push({ url: String(url), body: options.body }); return Response.json({ data: [{ b64_json: base.toString("base64") }] }); } });
  for (const [position, label] of Object.entries({ "top-left": "слева вверху", "top-right": "справа вверху", "bottom-left": "слева внизу", "bottom-right": "справа внизу" })) {
    for (const reference of [logo, jpegLogo]) {
      await image.createImageFromLogo('Новая сцена. Заголовок: «Один голос бренда».', reference, "owner", "https://klio.example", randomUUID(), { logoPlacement: "corner", logoPosition: position });
      const call = calls.at(-1), prompt = call.body.get("prompt");
      assert.match(call.url, /edits$/);
      assert.deepEqual(Buffer.from(await call.body.get("image").arrayBuffer()), Buffer.from(reference.bytes));
      assert.equal(call.body.get("image").type, reference.contentType);
      assert.match(prompt, /Один голос бренда/); assert.ok(prompt.includes(`размести его ${label}`));
      assert.match(prompt, /не копируй квадратную или прямоугольную подложку/);
      assert.match(prompt, /Компонуй логотип и разрешённый заголовок одновременно/);
      assert.match(prompt, /Не перекрывай логотипом текст/);
      assert.match(prompt, /форму, пропорции, цвета и собственную надпись/);
      assert.match(prompt, /Не стирай и не размывай картинку/);
      assert.equal(call.body.get("background"), "opaque");
      assert.doesNotMatch(prompt, /Логотип будет наложен приложением/);
      assert.deepEqual(Buffer.from(await uploads.at(-1).arrayBuffer()), base, "upload the composed model result without pasting the square file over it");
    }
  }
  assert.equal(calls.length, 8); assert.equal(uploads.length, 8);
  await image.createImageFromLogo("Новая сцена с логотипом", logo, "owner", "https://klio.example", "scene-test", { logoPlacement: "scene" });
  assert.match(calls.at(-1).url, /edits$/);
  assert.deepEqual(Buffer.from(await calls.at(-1).body.get("image").arrayBuffer()), Buffer.from(logo.bytes));
  assert.match(calls.at(-1).body.get("prompt"), /Впиши его в сцену/);
  assert.doesNotMatch(calls.at(-1).body.get("prompt"), /Компонуй логотип/);
  // Already-open clients may still submit the old overlay choice.
  for (const placement of ["corner", "overlay"]) {
    assert.equal(image.parseImageGenerationOptions({ logoPlacement: placement }).logoPlacement, "corner");
    await image.createImageFromSource("Добавь логотип к готовому изображению", { bytes: new Uint8Array(base), contentType: "image/png" }, "edit", jpegLogo, "owner", "https://klio.example", randomUUID(), { logoPlacement: placement, logoPosition: "top-left", background: "transparent" });
    const call = calls.at(-1), inputs = call.body.getAll("image[]");
    assert.match(call.url, /edits$/); assert.equal(inputs.length, 2);
    assert.deepEqual(Buffer.from(await inputs[0].arrayBuffer()), base);
    assert.deepEqual(Buffer.from(await inputs[1].arrayBuffer()), Buffer.from(jpegLogo.bytes));
    assert.equal(call.body.get("background"), "opaque"); assert.equal(call.body.get("size"), "auto");
    assert.match(call.body.get("prompt"), /Сохрани композицию/);
    assert.match(call.body.get("prompt"), /включая края и углы/);
    assert.match(call.body.get("prompt"), /Второе изображение — настоящий логотип/);
    assert.match(call.body.get("prompt"), /размести его слева вверху/);
    assert.match(call.body.get("prompt"), /При редактировании сохраняй существующие надписи/);
    assert.deepEqual(Buffer.from(await uploads.at(-1).arrayBuffer()), base);
  }
  assert.equal(uploads.length, 11);
});

test("relay receives the actual source and JPEG logo, while the largest dialogue brief keeps all composition rules", async () => {
  const { base, logo } = await fixtures();
  const jpeg = await sharp(Buffer.from(logo.bytes)).flatten({ background: "#132c52" }).jpeg().toBuffer();
  const requests = [], uploads = [];
  const image = load("app/api/_lib/image-generation.ts", {
    "./storage": { uploadPublicationImage: async file => { uploads.push(file); return "saved"; } },
    "./image-type": load("app/api/_lib/image-type.ts"), "./image-generation-errors": imageGenerationErrors,
  }, { process: { env: { KLIO_IMAGE_SERVICE_URL: "https://relay.example" } }, fetch: async (url, options) => {
    if (new URL(url).pathname === "/health") return Response.json({ maxImageInputs: 2 });
    requests.push(JSON.parse(options.body));
    return Response.json({ data: [{ b64_json: base.toString("base64") }] });
  } });
  const prompt = "Контекст ".repeat(1000).slice(0, 8000) + "\n\n" + promptModule.dialogueImageTextInstruction("title", "З".repeat(500), true, true);
  const reference = { bytes: new Uint8Array(jpeg), contentType: "image/jpeg" };
  await image.createImageFromLogo(prompt, reference, "owner", "https://klio.example", "relay-new", { logoPlacement: "overlay", logoPosition: "top-right" });
  assert.equal(requests[0].image_b64, jpeg.toString("base64")); assert.equal(requests[0].image_type, "image/jpeg");
  await image.createImageFromSource(prompt, { bytes: new Uint8Array(base), contentType: "image/png" }, "edit", reference, "owner", "https://klio.example", "relay-edit", { logoPlacement: "corner", logoPosition: "top-right" });
  assert.deepEqual(requests[1].images.map(input => input.image_b64), [base.toString("base64"), jpeg.toString("base64")]);
  assert.deepEqual(requests[1].images.map(input => input.image_type), ["image/png", "image/jpeg"]);
  for (const request of requests) {
    assert.equal(request.background, "opaque");
    assert.match(request.prompt, /Единственная новая надпись/);
    assert.ok(request.prompt.includes("З".repeat(500)));
    assert.match(request.prompt, /размести его справа вверху/);
    assert.match(request.prompt, /не копируй квадратную или прямоугольную подложку/);
    assert.match(request.prompt, /собственная надпись настоящего логотипа сохраняется\.$/);
    assert.ok(request.prompt.length <= 12000);
  }
  assert.equal(requests.length, 2); assert.equal(uploads.length, 2);
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
    await h.post(send({ imageTextMode, imageText: "Внутри студии", useLogo: true, logoPlacement: imageTextMode === "none" ? "overlay" : "corner", logoPosition: "top-left" }));
    thread = await h.settled(thread.id);
    assert.equal(thread.status, "idle");
    const args = h.imageCalls.at(-1).args;
    assert.match(args[0], /Съёмка в студии, камера и команда/);
    assert.match(args[0], imageTextMode === "none" ? /Не добавляй на изображение текст/ : /Единственная новая надпись.*Внутри студии/);
    assert.match(args[0], /собственной надписи в настоящем логотипе/);
    assert.equal(args[5].logoPlacement, "corner"); assert.equal(args[5].logoPosition, "top-left");
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
    "node:crypto": { createHash },
    "../../dialogue-generation-settings": { IMAGE_STYLE_OPTIONS: [] },
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
    const response = await post({ imageTextMode: mode, imageText: "Своя надпись", sourceGenerationId: "article", useLogo: true, logoPlacement: mode === "none" ? "overlay" : "corner", logoPosition: "bottom-left", outputFormat: "webp" });
    assert.equal(response.status, 200);
    const { args, logo } = calls.at(-1); assert.equal(logo, true);
    assert.match(args[0], mode === "none" ? /Не добавляй на изображение текст/ : mode === "title" ? /Единственная новая надпись.*Настоящий заголовок/ : /Единственная новая надпись.*Своя надпись/);
    assert.ok(!args[0].includes("Подмена"));
    assert.equal(args[5].logoPlacement, "corner"); assert.equal(args[5].logoPosition, "bottom-left"); assert.equal(args[5].outputFormat, "webp");
    assert.equal(recorded.at(-1).title, "Обложка: Настоящий заголовок");
  }
  assert.equal(recorded.length, 3);
  assert.equal((await post({ sourceGenerationId: "article", sourceTitle: "Моя ручная правка", imageTextMode: "title" })).status, 200);
  assert.match(calls.at(-1).args[0], /Единственная новая надпись.*Моя ручная правка/);
});
