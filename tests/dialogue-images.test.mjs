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
