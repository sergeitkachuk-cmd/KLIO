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

test("relay forwards authenticated bounded dialogue requests without exposing its OpenAI key", async t => {
  const token = "test-only-token-with-at-least-32-characters";
  const calls = [];
  const server = imageService({ token, apiKey: "fixture-provider-key", providerFetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Привет" }] }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/responses`;
  const body = JSON.stringify({ model: "gpt-6-luna", store: false, max_output_tokens: 100, input: "Привет", instructions: "Ответь" });
  assert.equal((await fetch(endpoint, { method: "POST", body })).status, 401);
  assert.equal((await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ model: "other", input: "x" }) })).status, 400);
  assert.equal(calls.length, 0);
  const result = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).output[0].content[0].text, "Привет");
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].options.headers.Authorization, "Bearer fixture-provider-key");
  assert.equal(JSON.parse(calls[0].options.body).model, "gpt-6-luna");

  const legacyBody = JSON.stringify({ model: "gpt-5.6-luna", store: false, max_output_tokens: 100, input: "Привет", instructions: "Ответь" });
  const legacyResult = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: legacyBody });
  assert.equal(legacyResult.status, 200);
  assert.equal(JSON.parse(calls[1].options.body).model, "gpt-5.6-luna");

  const nanoBody = JSON.stringify({ model: "gpt-5.4-nano", store: false, max_output_tokens: 100, input: "Привет", instructions: "Ответь" });
  const nanoResult = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: nanoBody });
  assert.equal(nanoResult.status, 200);
  assert.equal(JSON.parse(calls[2].options.body).model, "gpt-5.4-nano");
});

// The Agents SDK-based dialogue router (app/api/_lib/dialogue-agent.ts)
// always sends input as an array of role-tagged items for its multi-turn,
// tool-using calls, never a bare string, and its own Responses API call
// doesn't always carry a top-level instructions string either. Every one
// of its calls got rejected as "Invalid text request" until this relay
// accepted that shape too (site owner: reproduced live, "gpt-6-luna ...
// 400 Invalid text request" in the admin usage table for every dialogue
// call) - this is what actually exercises that fix, not just the
// pre-existing single-string-input case above.
test("relay accepts the Agents SDK's array-shaped input and optional instructions", async t => {
  const token = "test-only-token-with-at-least-32-characters";
  const calls = [];
  const server = imageService({ token, apiKey: "fixture-provider-key", providerFetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/responses`;
  const post = payload => fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });

  const arrayInput = [
    { role: "user", content: "КОНТЕКСТ KLIO: {}" },
    { role: "assistant", status: "completed", content: [{ type: "output_text", text: "Привет" }] },
    { role: "user", content: "Нарисуй картинку" },
  ];
  const withArrayInput = await post({ model: "gpt-6-luna", store: false, max_output_tokens: 2400, input: arrayInput });
  assert.equal(withArrayInput.status, 200, await withArrayInput.clone().text());
  assert.deepEqual(JSON.parse(calls.at(-1).options.body).input, arrayInput);
  assert.equal(JSON.parse(calls.at(-1).options.body).instructions, undefined);

  // store must still be exactly false - conversations stay unstored on
  // OpenAI's end regardless of caller, this relay's one privacy guarantee,
  // not something the shape fix should loosen.
  assert.equal((await post({ model: "gpt-6-luna", store: true, max_output_tokens: 100, input: arrayInput })).status, 400);
  // Still rejects garbage, not "anything goes now that input can be an array".
  assert.equal((await post({ model: "gpt-6-luna", store: false, max_output_tokens: 100, input: [] })).status, 400);
  assert.equal((await post({ model: "gpt-6-luna", store: false, max_output_tokens: 100, input: ["not an object"] })).status, 400);
  assert.equal((await post({ model: "gpt-6-luna", store: false, max_output_tokens: 100, input: "Привет", instructions: 12345 })).status, 400);
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

test("image generation forwards the selected model and max quality", async t => {
  let forwarded;
  const token = "test-only-token-with-at-least-32-characters";
  const server = imageService({ token, apiKey: "fixture-provider-key", providerFetch: async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return Response.json({ data: [{ b64_json: "fixture-image" }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/generate`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": "test-image-model-quality-0001" },
    body: JSON.stringify({ model: "gpt-image-2.5-sunburst", prompt: "A clinic", quality: "max" }),
  });
  assert.equal(response.status, 200);
  assert.equal(forwarded.model, "gpt-image-2.5-sunburst");
  assert.equal(forwarded.quality, "max");
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
