import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { load } from "./helpers/dialogue-harness.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const env = { S3_ENDPOINT: "https://storage.invalid", S3_REGION: "region", S3_BUCKET: "bucket", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test" };
const key = `publications/${"a".repeat(64)}/00000000-0000-0000-0000-000000000001.png`;

function storageWith(objects) {
  const puts = [];
  const notFound = Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
  const storage = load("app/api/_lib/storage.ts", {
    "@aws-sdk/client-s3": {
      S3Client: class {
        async send(command) {
          if (command.kind === "put") {
            puts.push(command.input);
            objects.set(command.input.Key, { bytes: command.input.Body, type: command.input.ContentType });
            return {};
          }
          const object = objects.get(command.input.Key);
          if (!object) throw notFound;
          return { ContentType: object.type, Body: { transformToByteArray: async () => object.bytes } };
        }
      },
      GetObjectCommand: class { constructor(input) { this.kind = "get"; this.input = input; } },
      PutObjectCommand: class { constructor(input) { this.kind = "put"; this.input = input; } },
    },
    "node:crypto": require("node:crypto"),
    // The test loader skips ESM interop for import("sharp"); the app bundler does it.
    sharp: { default: sharp },
    "./image-type": {}, "./pdf-type": {},
  }, { process: { env } });
  return { storage, puts };
}

// Gradient plus grain, like a photo: the content PNG compresses badly.
async function noisyPng(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const tone = (x * 255 / width) * (c === 0 ? 1 : 0.6) + (y * 200 / height) * (c === 2 ? 1 : 0.4);
    raw[(y * width + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(tone / 1.6 + ((seed >> 16) % 40) - 20)));
  }
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

test("an on-screen request gets a lighter WebP of identical size, stored once for later viewers", async () => {
  const original = await noisyPng(640, 480);
  const objects = new Map([[key, { bytes: original, type: "image/png" }]]);
  const { storage, puts } = storageWith(objects);

  const first = await storage.downloadPublicationImageForDisplay(key);
  assert.equal(first.contentType, "image/webp");
  assert.ok(first.bytes.byteLength < original.byteLength * 0.9);
  const size = await sharp(Buffer.from(first.bytes)).metadata();
  assert.deepEqual([size.width, size.height], [640, 480]);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(puts.length, 1);
  assert.equal(puts[0].Key, `${key}.display.webp`);

  const second = await storage.downloadPublicationImageForDisplay(key);
  assert.equal(second.contentType, "image/webp");
  assert.equal(puts.length, 1, "the stored copy is reused, not re-encoded");

  const download = await storage.downloadPublicationImage(key);
  assert.equal(download.contentType, "image/png");
  assert.deepEqual(download.bytes, original);
});

test("small images are shown as they are, without an extra copy", async () => {
  const tiny = await noisyPng(16, 16);
  const { storage, puts } = storageWith(new Map([[key, { bytes: tiny, type: "image/png" }]]));
  const result = await storage.downloadPublicationImageForDisplay(key);
  assert.equal(result.contentType, "image/png");
  assert.deepEqual(result.bytes, tiny);
  assert.equal(puts.length, 0);
});

function routeWith() {
  const calls = [];
  const image = (type) => async (requested) => { calls.push({ type, requested }); return { bytes: new Uint8Array([1, 2, 3]), contentType: type === "display" ? "image/webp" : "image/png" }; };
  const route = load("app/api/uploads/[...key]/route.ts", {
    "../../_lib/storage": {
      downloadPublicationImage: image("original"),
      downloadPublicationImageForDisplay: image("display"),
      StorageError: class extends Error {},
    },
  });
  const get = (url, headers = {}) => route.GET(new Request(url, { headers }), { params: Promise.resolve({ key: key.split("/") }) });
  return { calls, get };
}

test("only a browser <img> gets the light copy; downloads and Telegram/VK get the original", async () => {
  const { calls, get } = routeWith();
  const base = `https://klio.example.invalid/api/uploads/${key}`;
  const img = await get(base, { "sec-fetch-dest": "image", accept: "image/avif,image/webp,*/*" });
  assert.equal(img.headers.get("content-type"), "image/webp");
  assert.match(img.headers.get("vary") || "", /Sec-Fetch-Dest/);

  await get(`${base}?download=1`, { "sec-fetch-dest": "image", accept: "image/webp" });
  await get(base);
  await get(base, { "sec-fetch-dest": "empty", accept: "*/*" });
  assert.deepEqual(calls.map((call) => call.type), ["display", "original", "original", "original"]);
});
