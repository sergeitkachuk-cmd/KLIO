import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./helpers/dialogue-harness.mjs";

test("stored images keep inline responses and download with their actual file type only when requested", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const keys = [];
  const { GET } = load("app/api/uploads/[...key]/route.ts", {
    "../../_lib/storage": {
      StorageError: class extends Error {},
      downloadPublicationImage: async (key) => { keys.push(key); return { bytes, contentType: "image/webp" }; },
    },
  });
  const key = `publications/${"a".repeat(64)}/00000000-0000-0000-0000-000000000001.webp`;
  const context = { params: Promise.resolve({ key: key.split("/") }) };
  const url = `https://klio.example.invalid/api/uploads/${key}`;
  const inline = await GET(new Request(url), context);
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get("Content-Disposition"), null);
  assert.equal(inline.headers.get("Content-Type"), "image/webp");
  assert.deepEqual(new Uint8Array(await inline.arrayBuffer()), bytes);
  const attachment = await GET(new Request(`${url}?download=1`), context);
  assert.equal(attachment.status, 200);
  assert.equal(attachment.headers.get("Content-Disposition"), 'attachment; filename="klio-image.webp"');
  assert.equal(attachment.headers.get("Content-Type"), "image/webp");
  assert.deepEqual(new Uint8Array(await attachment.arrayBuffer()), bytes);
  assert.deepEqual(keys, [key, key]);
  const refused = await GET(new Request(`${url}?download=1`), { params: Promise.resolve({ key: ["unrelated", "file"] }) });
  assert.equal(refused.status, 404);
  assert.equal(keys.length, 2, "downloads must preserve the storage key restriction");
});
