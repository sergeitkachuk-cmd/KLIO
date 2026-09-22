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
