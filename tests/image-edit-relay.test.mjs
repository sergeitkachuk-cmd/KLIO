import test from "node:test";
import assert from "node:assert/strict";
import { imageService } from "../services/klio-images/server.mjs";

test("relay advertises two inputs and preserves their order, original size and idempotency", async t => {
  const token = "fixture-token-with-at-least-32-characters";
  let calls = 0;
  const server = imageService({ token, apiKey: "fixture-key", providerFetch: async (url, options) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/images/edits");
    assert.equal(options.body.get("size"), "auto");
    const images = options.body.getAll("image[]"); assert.equal(images.length, 2);
    assert.equal(await images[0].text(), "scene"); assert.equal(await images[1].text(), "logo");
    return Response.json({ data: [{ b64_json: "fixture" }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/health`)).json()).maxImageInputs, 2);
  const body = { prompt: "Добавь логотип", size: "auto", images: ["scene", "logo"].map(s => ({ image_type: "image/png", image_b64: Buffer.from(s).toString("base64") })) };
  const post = (input, id = "two-images-request-0001") => fetch(`${base}/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": id }, body: JSON.stringify(input) });
  assert.equal((await post(body)).status, 200);
  assert.equal((await post(body)).status, 200); assert.equal(calls, 1);
  assert.equal((await post({ ...body, images: [...body.images].reverse() })).status, 409);
  assert.equal((await post({ ...body, size: "1024x1024" })).status, 409);
  assert.equal((await post({ ...body, images: [...body.images, body.images[0]] }, "too-many-images-request")).status, 400);
  assert.equal(calls, 1);
});

test("relay defaults to maximum image quality and forwards a transparent edit mask", async t => {
  const token = "fixture-token-with-at-least-32-characters";
  const source = Buffer.from("source-image");
  const mask = Buffer.from("alpha-mask-png");
  let calls = 0;
  const server = imageService({ token, apiKey: "fixture-key", providerFetch: async (_url, options) => {
    calls++;
    assert.equal(options.body.get("quality"), "max");
    assert.equal(options.body.get("mask").type, "image/png");
    assert.deepEqual(Buffer.from(await options.body.get("mask").arrayBuffer()), mask);
    assert.deepEqual(Buffer.from(await options.body.get("image").arrayBuffer()), source);
    return Response.json({ data: [{ b64_json: "fixture" }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, id = "mask-image-request-0001") => fetch(`${base}/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": id }, body: JSON.stringify(body) });
  const body = { prompt: "Измени отмеченную часть изображения", image_type: "image/png", image_b64: source.toString("base64"), mask_type: "image/png", mask_b64: mask.toString("base64") };
  assert.equal((await post(body)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await post({ ...body, mask_b64: Buffer.from("different-mask").toString("base64") })).status, 409);
  assert.equal((await post({ ...body, images: [{ image_type: "image/png", image_b64: body.image_b64 }, { image_type: "image/png", image_b64: body.image_b64 }] }, "mask-needs-one-image-0001")).status, 400);
});

test("relay forwards OpenAI partial image events and caches the completed stream", async t => {
  const token = "fixture-token-with-at-least-32-characters";
  let calls = 0;
  const upstreamEvents = [
    { type: "image_generation.partial_image", b64_json: "cGFydGlhbA==", output_format: "png" },
    { type: "image_generation.completed", b64_json: "ZmluYWw=", output_format: "png" },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
  const server = imageService({ token, apiKey: "fixture-key", providerFetch: async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.stream, true);
    assert.equal(payload.partial_images, 2);
    return new Response(upstreamEvents, { headers: { "Content-Type": "text/event-stream" } });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = { prompt: "Draw a sample image", stream: true };
  const post = () => fetch(`${base}/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": "stream-image-request-0001" }, body: JSON.stringify(body) });
  const first = await post();
  assert.equal(first.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const events = await first.text();
  assert.match(events, /"type":"partial","b64_json":"cGFydGlhbA=="/);
  assert.match(events, /"type":"complete","b64_json":"ZmluYWw="/);
  assert.match(await (await post()).text(), /"type":"complete","b64_json":"ZmluYWw="/);
  assert.equal(calls, 1);
});
