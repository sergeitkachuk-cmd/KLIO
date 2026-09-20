import test from "node:test";
import assert from "node:assert/strict";
import { imageService } from "../services/klio-images/server.mjs";

test("image service authenticates, reuses duplicate work and never exposes provider credentials", async t => {
  let calls = 0;
  const token = "test-only-token-with-at-least-32-characters";
  const server = imageService({ token, apiKey: "fixture-provider-key", providerFetch: async (url, options) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/images/generations");
    assert.equal(options.headers.Authorization, "Bearer fixture-provider-key");
    return Response.json({ data: [{ b64_json: "fixture-image" }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/generate`;
  const post = (prompt, authorized = true) => fetch(url, { method: "POST", headers: { ...(authorized ? { Authorization: `Bearer ${token}` } : {}), "Idempotency-Key": "test-request-00000000001" }, body: JSON.stringify({ prompt }) });
  assert.equal((await post("Кофейня", false)).status, 401); assert.equal(calls, 0);
  const responses = await Promise.all([post("Кофейня"), post("Кофейня")]);
  assert.equal(calls, 1);
  for (const response of responses) { assert.equal(response.status, 200); const body = await response.text(); assert.ok(body.includes("fixture-image")); assert.ok(!body.includes("fixture-provider-key")); }
  assert.equal((await post("Другой запрос")).status, 409);
  assert.equal(calls, 1);
});

test("image service forwards the caller's size, quality and format instead of hardcoding them", async t => {
  const requests = [];
  const token = "test-only-token-with-at-least-32-characters";
  const server = imageService({ token, apiKey: "fixture-provider-key", providerFetch: async (url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ data: [{ b64_json: "fixture-image" }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/generate`;
  const post = (body, id) => fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": id }, body: JSON.stringify(body) });

  await post({ prompt: "Кофейня", size: "1536x1024", quality: "high", output_format: "jpeg", background: "opaque" }, "test-honors-request-000001");
  assert.deepEqual(requests[0], { model: "gpt-image-2.5-flare", prompt: "Кофейня", n: 1, size: "1536x1024", quality: "high", output_format: "jpeg", background: "opaque" });

  await post({ prompt: "Кофейня" }, "test-defaults-request-0000001");
  assert.deepEqual(requests[1], { model: "gpt-image-2.5-flare", prompt: "Кофейня", n: 1, size: "1024x1024", quality: "medium", output_format: "png" });

  await post({ prompt: "Кофейня", size: "1536x864" }, "test-custom-size-request-00001");
  assert.equal(requests[2].size, "1536x864");

  await post({ prompt: "Кофейня", size: "not-a-size", quality: "invalid", output_format: "invalid" }, "test-invalid-values-000001");
  assert.deepEqual(requests[3], { model: "gpt-image-2.5-flare", prompt: "Кофейня", n: 1, size: "1024x1024", quality: "medium", output_format: "png" });
});

test("image service routes a reference image through the edit endpoint with no mask", async t => {
  const calls = [];
  const token = "test-only-token-with-at-least-32-characters";
  const server = imageService({ token, apiKey: "fixture-provider-key", providerFetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ data: [{ b64_json: "fixture-image" }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/generate`;
  const logoBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const post = (body, id) => fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": id }, body: JSON.stringify(body) });

  const response = await post({ prompt: "Кофейня с логотипом", image_b64: logoBytes.toString("base64"), image_type: "image/png" }, "test-with-logo-request-000001");
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/edits");
  assert.equal(calls[0].options.headers.Authorization, "Bearer fixture-provider-key");
  assert.equal(calls[0].options.headers["Content-Type"], undefined); // fetch sets the multipart boundary itself from the FormData body
  const form = calls[0].options.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("prompt"), "Кофейня с логотипом");
  assert.equal(form.get("model"), "gpt-image-2.5-flare");
  const image = form.get("image");
  assert.ok(image instanceof Blob);
  assert.equal(image.type, "image/png");
  assert.equal(Buffer.from(await image.arrayBuffer()).toString("hex"), logoBytes.toString("hex"));

  assert.equal((await post({ prompt: "Кофейня", image_b64: "not base64 but present", image_type: "image/svg+xml" }, "test-bad-image-type-0001")).status, 400);
  assert.equal(calls.length, 1);
});
