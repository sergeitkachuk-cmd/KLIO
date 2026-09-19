import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { combinedService } from "../services/klio-images/combined.mjs";

test("shared listener preserves Telegram requests and files while protecting image generation", async t => {
  const seen = [];
  const telegram = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    seen.push({ path: request.url, method: request.method, body, authorization: request.headers.authorization });
    if (request.url.startsWith("/file/")) { response.writeHead(200, { "Content-Type": "image/png" }); response.end(Buffer.from([137, 80, 78, 71])); return; }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => telegram.listen(0, "127.0.0.1", resolve));
  let calls = 0;
  const token = "test-only-secret-longer-than-32-characters";
  const server = combinedService({ telegramPort: telegram.address().port, token, apiKey: "fixture", providerFetch: async () => { calls++; return Response.json({ data: [{ b64_json: "image" }] }); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => telegram.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/health/telegram`)).status, 200);
  const result = await fetch(`${url}/bot123:fixture/sendPhoto?test=1`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "must-not-reach-telegram" }, body: '{"photo":"https://example.invalid/photo.png"}' });
  assert.deepEqual(await result.json(), { ok: true });
  assert.deepEqual(seen[0], { path: "/bot123:fixture/sendPhoto?test=1", method: "POST", body: '{"photo":"https://example.invalid/photo.png"}', authorization: undefined });
  assert.deepEqual(new Uint8Array(await (await fetch(`${url}/file/bot123:fixture/photo.png`)).arrayBuffer()), new Uint8Array([137, 80, 78, 71]));
  assert.equal((await fetch(`${url}/generate`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`${url}/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": "test-null-request-00001" }, body: "null" })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await fetch(`${url}/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": "test-real-request-00001" }, body: '{"prompt":"Coffee"}' })).status, 200);
  assert.equal(calls, 1);
  assert.equal(seen.length, 2);
});
