import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { load } from "./helpers/dialogue-harness.mjs";

const url = (id, ext = "png") => `https://klio.example/api/uploads/publications/${"a".repeat(64)}/${id.padEnd(36, "0")}.${ext}`;
const thread = (urls) => ({ data: { cards: urls.map((imageUrl) => ({ imageUrl })) } });
const helper = (read) => load("app/api/_lib/chatkit-image-preview.ts", {
  sharp: { default: sharp }, "./storage": { publicationImageHeader: read },
});

test("thumbnail dimensions come from actual landscape, square and portrait image headers and are cached", async () => {
  const inputs = [[1536, 1024, "png"], [1024, 1536, "jpeg"], [1024, 1024, "webp"]];
  const files = new Map();
  for (const [index, [width, height, format]] of inputs.entries()) {
    const imageUrl = url(String(index), format === "jpeg" ? "jpg" : format);
    const bytes = await sharp({ create: { width, height, channels: 3, background: "#123456" } }).toFormat(format).toBuffer();
    files.set(imageUrl, bytes.subarray(0, 65536));
  }
  let reads = 0;
  const h = helper(async (key) => { reads++; return files.get(`https://klio.example/api/uploads/${key}`); });
  const result = await h.imagePreviewSizes(thread([...files.keys()]));
  for (const [index, imageUrl] of [...files.keys()].entries()) {
    assert.equal(result.get(imageUrl).width, inputs[index][0]);
    assert.equal(result.get(imageUrl).height, inputs[index][1]);
  }
  await h.imagePreviewSizes(thread([...files.keys()]));
  assert.equal(reads, 3);
});

test("invalid URLs never cause external fetches; missing headers do not break history", async () => {
  let reads = 0;
  const h = helper(async () => { reads++; throw new Error("Missing image"); });
  const images = ["https://169.254.169.254/private", "file:///secret", "bad-url", "https://evil.example/api/uploads/brand-books/private.pdf", url("1")];
  assert.equal((await h.imagePreviewSizes(thread(images))).size, 0);
  assert.equal(reads, 1);
  await h.imagePreviewSizes(thread(images));
  assert.equal(reads, 1, "a failing object is briefly cached too");
});

test("image header lookups deduplicate concurrent history reads and limit concurrency to four", async () => {
  const bytes = await sharp({ create: { width: 120, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
  let active = 0, maximum = 0, reads = 0;
  const h = helper(async () => {
    reads++; maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return bytes;
  });
  const data = thread(Array.from({ length: 10 }, (_, index) => url(index.toString(16))));
  const [a, b] = await Promise.all([h.imagePreviewSizes(data), h.imagePreviewSizes(data)]);
  assert.equal(reads, 10);
  assert.ok(maximum <= 4);
  assert.equal(a.size, 10); assert.equal(b.size, 10);
});

test("S3 header reads request a bounded range and cancel a stalled response body", async () => {
  let command;
  let destroyed = false;
  const body = { transformToByteArray: () => new Promise(() => {}), destroy: () => { destroyed = true; } };
  const h = load("app/api/_lib/storage.ts", {
    "@aws-sdk/client-s3": {
      S3Client: class { async send(value) { command = value; return { ContentLength: 65536, Body: body }; } },
      GetObjectCommand: class { constructor(input) { Object.assign(this, input); } }, PutObjectCommand: class {},
    },
    "node:crypto": await import("node:crypto"),
    "./image-type": {}, "./pdf-type": {},
  }, { process: { env: { S3_ENDPOINT: "https://storage.invalid", S3_REGION: "region", S3_BUCKET: "bucket", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test" } } });
  const controller = new AbortController();
  const key = new URL(url("1")).pathname.slice("/api/uploads/".length);
  const request = h.publicationImageHeader(key, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort(new Error("deadline"));
  await assert.rejects(request, /deadline/);
  assert.equal(destroyed, true);
  assert.equal(command.Range, "bytes=0-65535");
  await assert.rejects(h.publicationImageHeader("brand-books/private.pdf", new AbortController().signal), (error) => error.status === 400);
});
