import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDialogueHarness, load } from "./helpers/dialogue-harness.mjs";
import { imageService } from "../services/klio-images/server.mjs";

const sourceUrl = (email) => `https://klio.example/api/uploads/publications/${createHash("sha256").update(email).digest("hex")}/${randomUUID()}.png`;
const payload = (thread, extra = {}) => ({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), mode: "image", text: "Добавь на это изображение наш логотип", settings: {}, ...extra });
async function seed(h, brandId = "") {
  const thread = await h.create(brandId);
  thread.data = { messages: [{ id: "old-request", role: "user", text: "Старая сцена с камерой", mode: "image" }, { id: "answer", role: "assistant", text: "Готово", cardIds: ["original"] }],
    cards: [{ id: "original", kind: "post", title: "Сцена", body: "", imageUrl: sourceUrl(h.owner), versions: [] }] };
  await h.db.update(h.schema.dialogueThreads).set({ dataJson: JSON.stringify(thread.data) }).where(eq(h.schema.dialogueThreads.id, thread.id));
  return thread;
}

test("adding a logo edits the actual previous image and preserves the original card", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  await h.db.insert(h.schema.brands).values({ id: "studio", name: "Студия", ownerEmail: h.owner, profileJson: JSON.stringify({ logoKey: "real-logo" }) });
  const original = await seed(h, "studio");
  const request = payload(original);
  await h.post(request); await h.post(request);
  const result = await h.settled(original.id);
  assert.equal(result.status, "idle");
  assert.equal(h.imageCalls.length, 1); assert.equal(h.imageCalls[0].source, true); assert.equal(h.imageCalls[0].logo, true);
  assert.equal(h.imageCalls[0].args[2], "edit");
  assert.deepEqual([...h.imageCalls[0].args[1].bytes], [1, 2, 3]);
  assert.equal(h.imageDownloads[0], new URL(original.data.cards[0].imageUrl).pathname.slice("/api/uploads/".length));
  assert.ok(!h.imageCalls[0].args[0].includes("Старая сцена с камерой"));
  assert.equal(result.data.cards.length, 2);
  assert.equal(result.data.cards[0].imageUrl, original.data.cards[0].imageUrl);
  assert.equal(result.data.messages.find(m => m.id === request.requestId).imageSource.purpose, "edit");
  assert.equal((await h.account()).generationsUsed, 1);
  const materials = await h.db.select().from(h.schema.generations);
  assert.equal(materials.length, 1); assert.equal(materials[0].body, "");
});

test("foreign, external, missing and ambiguous image sources are rejected before debiting", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  const thread = await seed(h);
  for (const imageSource of [
    { uploadUrl: sourceUrl("someone-else@example.invalid"), purpose: "edit" },
    { uploadUrl: "https://evil.invalid/private.png", purpose: "edit" },
    { cardId: "other-thread-card", purpose: "edit" },
    { cardId: "original", slideIndex: 1, purpose: "edit" },
    { cardId: "original", uploadUrl: thread.data.cards[0].imageUrl, purpose: "edit" },
  ]) {
    const response = await h.request(payload(thread, { text: "Убери лишний предмет", imageSource }));
    assert.equal(response.status, 400);
  }
  const fresh = await h.create();
  assert.equal((await h.request(payload(fresh, { text: "Измени фон" }))).status, 400);
  assert.equal((await h.request(payload(thread))).status, 400); // No brand logo: never invent it.
  assert.equal((await h.account()).generationsUsed, 0); assert.equal(h.imageCalls.length, 0);
});

test("uploaded references and explicit older slides use the chosen source; errors refund quota", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  let thread = await seed(h);
  const uploaded = sourceUrl(h.owner);
  await h.post(payload(thread, { text: "Новый интерьер в таком стиле", imageSource: { uploadUrl: uploaded, purpose: "reference" } }));
  thread = await h.settled(thread.id);
  assert.equal(h.imageCalls[0].args[2], "reference");
  assert.equal(h.imageDownloads[0], new URL(uploaded).pathname.slice("/api/uploads/".length));
  h.setEditImage(async () => { throw new Error("Provider unavailable"); });
  await h.post(payload(thread, { text: "Убери камеру", imageSource: { cardId: "original", purpose: "edit" } }));
  thread = await h.settled(thread.id);
  assert.equal(thread.status, "failed"); assert.equal((await h.account()).generationsUsed, 1);
  assert.equal((await h.db.select().from(h.schema.generations)).length, 1);
  assert.equal(h.imageDownloads[1], new URL(thread.data.cards[0].imageUrl).pathname.slice("/api/uploads/".length));
});

test("late image edits cannot save a material after a timeout refund", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  let release;
  h.setEditImage(() => new Promise(resolve => { release = resolve; }));
  const thread = await seed(h);
  await h.post(payload(thread, { text: "Измени фон" }));
  for (let i = 0; !release && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(release);
  await h.db.update(h.schema.dialogueThreads).set({ updatedAt: new Date(Date.now() - 300_000).toISOString() }).where(eq(h.schema.dialogueThreads.id, thread.id));
  assert.equal((await h.read(thread.id)).thread.status, "failed");
  release("https://example.invalid/late-image.png"); await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await h.account()).generationsUsed, 0);
  assert.equal((await h.db.select().from(h.schema.generations)).length, 0);
  assert.equal((await h.read(thread.id)).thread.data.cards.length, 1);
});

const png = (label) => new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(label)]));
test("app and Render deliver source then logo as two files to edits, without changing source size", async t => {
  const source = { bytes: png("source-scene"), contentType: "image/png" };
  const logo = { bytes: png("brand-logo"), contentType: "image/png" };
  const token = "fixture-token-with-at-least-32-characters";
  let providerCalls = 0; let uploaded;
  const server = imageService({ token, apiKey: "fixture-key", providerFetch: async (url, options) => {
    providerCalls++;
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    const images = options.body.getAll("image[]"); assert.equal(images.length, 2);
    assert.deepEqual(new Uint8Array(await images[0].arrayBuffer()), source.bytes);
    assert.deepEqual(new Uint8Array(await images[1].arrayBuffer()), logo.bytes);
    assert.equal(options.body.get("size"), "auto");
    assert.match(options.body.get("prompt"), /Сохрани композицию/);
    return Response.json({ data: [{ b64_json: Buffer.from(png("edited")).toString("base64") }] });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const local = `http://127.0.0.1:${server.address().port}`;
  const image = load("app/api/_lib/image-generation.ts", {
    "./storage": { storageConfigured: () => true, uploadPublicationImage: async (file) => { uploaded = file; return "saved-image"; } },
    "./image-type": load("app/api/_lib/image-type.ts"),
  }, { FormData, process: { env: { KLIO_IMAGE_SERVICE_URL: "https://relay.example", KLIO_IMAGE_SERVICE_TOKEN: token } }, fetch: (url, options) => fetch(`${local}${new URL(url).pathname}`, options) });
  assert.equal(await image.createImageFromSource("Добавь логотип", source, "edit", logo, "owner", "https://klio.example", "edit-request-000000001", { aspectRatio: "1:1", outputFormat: "png" }), "saved-image");
  assert.equal(providerCalls, 1); assert.equal(uploaded.type, "image/png");
});

test("an old relay is rejected before billing instead of silently dropping the source or logo", async () => {
  const calls = [];
  const image = load("app/api/_lib/image-generation.ts", {
    "./storage": { storageConfigured: () => true }, "./image-type": load("app/api/_lib/image-type.ts"),
  }, { process: { env: { KLIO_IMAGE_SERVICE_URL: "https://relay.example" } }, fetch: async (url) => { calls.push(new URL(url).pathname); return Response.json({ ready: true }); } });
  const reference = { bytes: png("source"), contentType: "image/png" };
  await assert.rejects(image.createImageFromSource("Логотип", reference, "edit", reference, "owner", "https://klio.example", "edit-request-000000001"), /ещё не обновлён/);
  assert.deepEqual(calls, ["/health"]);
});

test("discussion overrides stale modes but briefs, quoted headlines and edits retain generation", () => {
  const { resolveDialogueTool } = load("app/dialogue-starters.ts");
  for (const mode of ["image", "topics", "text", "carousel"]) {
    for (const text of ["А почему ты выбрал такой фон?", "Мне кажется, это слишком сложно для аудитории", "Давай обсудим идею", "Можно ли сделать это по-другому?", "Спасибо!", "Расскажи, как продвигать студию"])
      assert.equal(resolveDialogueTool(text, mode), "chat", `${mode}: ${text}`);
    for (const text of ["Творческий процесс в студии", "Сделай ещё один вариант", "Тема: почему выбирают нас?", "Добавь логотип"]) assert.equal(resolveDialogueTool(text, mode), mode);
  }
  assert.equal(resolveDialogueTool("Измени фон", null, undefined, true), "image");
  assert.equal(resolveDialogueTool("Измени фон", "chat", undefined, true), "chat");
  assert.equal(resolveDialogueTool("Почему выбирают нас?", "image", "topic-post"), "topic-post");
});
