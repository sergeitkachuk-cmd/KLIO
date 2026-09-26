import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import test from "node:test";
import { load, imageGenerationErrors, imageCost } from "./helpers/dialogue-harness.mjs";

async function fixtures(width = 1024, height = 768, sourceFormat = "jpeg") {
  const source = await sharp({ create: { width, height, channels: 3, background: "#4974a2" } })[sourceFormat]().toBuffer();
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  for (let y = Math.floor(height / 3); y < Math.floor((height * 2) / 3); y += 1) {
    for (let x = Math.floor(width / 3); x < Math.floor((width * 2) / 3); x += 1) {
      pixels[(y * width + x) * 4 + 3] = 0;
    }
  }
  const mask = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const generated = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 80, g: 120, b: 160, alpha: 1 } } }).png().toBuffer();
  return { source, mask, generated };
}

function loadImageGeneration(fetch, env = {}) {
  const uploads = [];
  const requests = [];
  const imageGen = load("app/api/_lib/image-generation.ts", {
    "sharp": { default: sharp },
    "./storage": { storageConfigured: () => true, uploadPublicationImage: async file => { uploads.push(file); return "https://klio.example.invalid/saved.png"; } },
    "./image-type": load("app/api/_lib/image-type.ts"),
    "./image-generation-errors": imageGenerationErrors,
    "./image-cost": imageCost,
  }, {
    FormData,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return fetch(url, options);
    },
    process: { env },
  });
  return { imageGen, uploads, requests };
}

test("brush edit normalizes JPEG input and transparent mask to matching PNG files", async () => {
  const { source, mask, generated } = await fixtures();
  const app = loadImageGeneration(async () => Response.json({ data: [{ b64_json: generated.toString("base64") }] }));
  const result = await app.imageGen.createImageFromSource(
    "Добавь цветок в выделенной области", { bytes: new Uint8Array(source), contentType: "image/jpeg" }, "edit", undefined,
    "owner@example.invalid", "https://klio.example.invalid", randomUUID(), {},
    { bytes: new Uint8Array(mask), contentType: "image/png" },
  );

  assert.equal(result, "https://klio.example.invalid/saved.png");
  assert.equal(app.requests.length, 1);
  assert.match(app.requests[0].url, /\/v1\/images\/edits$/);
  const form = app.requests[0].options.body;
  assert.equal(form.get("model"), "gpt-image-2.5-sunburst-2026-09-08");
  const imageFile = form.get("image");
  const maskFile = form.get("mask");
  assert.equal(imageFile.type, "image/png");
  assert.equal(maskFile.type, "image/png");
  const imageBytes = Buffer.from(await imageFile.arrayBuffer());
  const maskBytes = Buffer.from(await maskFile.arrayBuffer());
  const imageMetadata = await sharp(imageBytes).metadata();
  const maskMetadata = await sharp(maskBytes).metadata();
  assert.deepEqual([imageMetadata.width, imageMetadata.height], [1024, 768]);
  assert.deepEqual([maskMetadata.width, maskMetadata.height], [imageMetadata.width, imageMetadata.height]);
  assert.equal(maskMetadata.hasAlpha, true);
  assert.ok(imageMetadata.width * imageMetadata.height >= 655_360);
  assert.ok(imageMetadata.width * imageMetadata.height <= 8_294_400);
  assert.equal(app.uploads.length, 1);
});

test("small source images are enlarged with the mask to the provider's minimum area", async () => {
  const { source, mask, generated } = await fixtures(200, 120);
  const app = loadImageGeneration(async () => Response.json({ data: [{ b64_json: generated.toString("base64") }] }));
  await app.imageGen.createImageFromSource(
    "Измени выделенную область", { bytes: new Uint8Array(source), contentType: "image/jpeg" }, "edit", undefined,
    "owner@example.invalid", "https://klio.example.invalid", randomUUID(), {},
    { bytes: new Uint8Array(mask), contentType: "image/png" },
  );
  const form = app.requests[0].options.body;
  const imageMetadata = await sharp(Buffer.from(await form.get("image").arrayBuffer())).metadata();
  const maskMetadata = await sharp(Buffer.from(await form.get("mask").arrayBuffer())).metadata();
  const pixels = imageMetadata.width * imageMetadata.height;
  assert.ok(pixels >= 655_360 && pixels <= 8_294_400);
  assert.deepEqual([maskMetadata.width, maskMetadata.height], [imageMetadata.width, imageMetadata.height]);
  assert.equal(maskMetadata.hasAlpha, true);
});

test("brush rejects a mismatched mask before contacting the image provider", async () => {
  const { source, mask } = await fixtures();
  const wrongMask = await sharp(mask).resize(512, 512).png().toBuffer();
  const app = loadImageGeneration(async () => { throw new Error("provider must not be called"); });
  await assert.rejects(
    app.imageGen.createImageFromSource(
      "Измени выделенную область", { bytes: new Uint8Array(source), contentType: "image/jpeg" }, "edit", undefined,
      "owner@example.invalid", "https://klio.example.invalid", randomUUID(), {},
      { bytes: new Uint8Array(wrongMask), contentType: "image/png" },
    ),
    /Размер выделения не совпадает/,
  );
  assert.equal(app.requests.length, 0);
});

test("old image relay capability response refuses brush edits before a paid request", async () => {
  const { source, mask } = await fixtures();
  const app = loadImageGeneration(async url => new URL(url).pathname === "/health"
    ? Response.json({ ready: true, maxImageInputs: 2 })
    : Response.json({ data: [{ b64_json: "unexpected" }] }), { KLIO_IMAGE_SERVICE_URL: "https://relay.example.invalid", KLIO_IMAGE_SERVICE_TOKEN: "test-token" });
  await assert.rejects(
    app.imageGen.createImageFromSource(
      "Измени выделенную область", { bytes: new Uint8Array(source), contentType: "image/jpeg" }, "edit", undefined,
      "owner@example.invalid", "https://klio.example.invalid", randomUUID(), {},
      { bytes: new Uint8Array(mask), contentType: "image/png" },
    ),
    /требуется обновить сервер изображений/,
  );
  assert.equal(app.requests.filter(request => new URL(request.url).pathname === "/generate").length, 0);
});

test("app sends a brush mask to a relay only after its health response advertises support", async () => {
  const { source, mask, generated } = await fixtures();
  const app = loadImageGeneration(async (url, options) => {
    if (new URL(url).pathname === "/health") return Response.json({ ready: true, maxImageInputs: 2, editMasks: true });
    const body = JSON.parse(options.body);
    return Response.json({ data: [{ b64_json: generated.toString("base64") }], received: body });
  }, { KLIO_IMAGE_SERVICE_URL: "https://relay.example.invalid", KLIO_IMAGE_SERVICE_TOKEN: "test-token" });
  await app.imageGen.createImageFromSource(
    "Измени выделенную область", { bytes: new Uint8Array(source), contentType: "image/jpeg" }, "edit", undefined,
    "owner@example.invalid", "https://klio.example.invalid", randomUUID(), {},
    { bytes: new Uint8Array(mask), contentType: "image/png" },
  );
  const request = app.requests.find(item => new URL(item.url).pathname === "/generate");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(body.image_type, "image/png");
  assert.equal(body.mask_type, "image/png");
  assert.equal(body.mask_b64, Buffer.from(body.mask_b64, "base64").toString("base64"));
  const sourceMetadata = await sharp(Buffer.from(body.image_b64, "base64")).metadata();
  const maskMetadata = await sharp(Buffer.from(body.mask_b64, "base64")).metadata();
  assert.equal(sourceMetadata.format, "png");
  assert.equal(maskMetadata.format, "png");
  assert.equal(maskMetadata.hasAlpha, true);
  assert.deepEqual([sourceMetadata.width, sourceMetadata.height], [maskMetadata.width, maskMetadata.height]);
});
