import assert from "node:assert/strict";
import test from "node:test";
import { imageService } from "../services/klio-images/server.mjs";

function pngHeader(width = 1024, height = 1024, colorType = 6) {
  const bytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = colorType;
  bytes[30] = 1;
  return bytes;
}

test("relay advertises and forwards transparent PNG brush masks, with mask-aware idempotency", async t => {
  const token = "fixture-token-with-at-least-32-characters";
  const source = pngHeader();
  const mask = pngHeader();
  const calls = [];
  const server = imageService({ token, apiKey: "fixture-key", providerFetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ data: [{ b64_json: "fixture-image" }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).editMasks, true);

  const body = {
    model: "gpt-image-2.5-sunburst-2026-09-08",
    prompt: "Измени выделенную область",
    image_b64: source.toString("base64"),
    image_type: "image/png",
    mask_b64: mask.toString("base64"),
    mask_type: "image/png",
  };
  const post = (input, id = "mask-image-request-0001") => fetch(`${base}/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": id },
    body: JSON.stringify(input),
  });
  assert.equal((await post(body)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/edits");
  const form = calls[0].options.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("model"), "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(form.get("image").type, "image/png");
  assert.equal(form.get("mask").type, "image/png");
  assert.deepEqual(Buffer.from(await form.get("image").arrayBuffer()), source);
  assert.deepEqual(Buffer.from(await form.get("mask").arrayBuffer()), mask);
  const differentMask = Buffer.from(mask);
  differentMask[30] = 2;
  assert.equal((await post({ ...body, mask_b64: differentMask.toString("base64") })).status, 409);
  assert.equal(calls.length, 1);
});

test("relay rejects masks without one matching alpha PNG source before calling the provider", async t => {
  const token = "fixture-token-with-at-least-32-characters";
  let calls = 0;
  const server = imageService({ token, apiKey: "fixture-key", providerFetch: async () => {
    calls += 1;
    return Response.json({ data: [{ b64_json: "fixture-image" }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = pngHeader();
  const mask = pngHeader();
  const body = { prompt: "Измени область", image_b64: source.toString("base64"), image_type: "image/png", mask_b64: mask.toString("base64"), mask_type: "image/png" };
  const post = (input, id) => fetch(`${base}/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": id }, body: JSON.stringify(input) });

  assert.equal((await post({ ...body, image_type: "image/jpeg" }, "mask-reject-jpeg-source-01")).status, 400);
  assert.equal((await post({ ...body, mask_b64: pngHeader(512, 512).toString("base64") }, "mask-reject-size-mismatch-1")).status, 400);
  assert.equal((await post({ ...body, mask_b64: pngHeader(1024, 1024, 2).toString("base64") }, "mask-reject-no-alpha-0001")).status, 400);
  assert.equal((await post({ ...body, mask_b64: pngHeader(256, 256).toString("base64") }, "mask-reject-small-source-1")).status, 400);
  assert.equal(calls, 0);
});
