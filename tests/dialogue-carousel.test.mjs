import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDialogueHarness, load } from "./helpers/dialogue-harness.mjs";

const slides = () => ({ slides: Array.from({ length: 3 }, (_, i) => ({ headline: `Слайд ${i + 1}`, subtext: "Практический совет по подготовке к съёмкам." })) });
const payload = (thread, extra = {}) => ({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), mode: "carousel", text: "Как подготовить студию к съёмке интервью: свет, звук и камеры.", settings: { slideCount: 3 }, ...extra });

test("carousel quota is reserved once on duplicate sends and errors refund every slide", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  let release;
  h.setAi(() => new Promise(resolve => { release = resolve; }));
  const thread = await h.create(); const request = payload(thread);
  await h.post(request); await h.post(request);
  assert.equal((await h.account()).generationsUsed, 3);
  assert.equal(h.calls(), 1);
  h.setCarouselImage(async () => { throw new Error("Image provider unavailable"); });
  release(slides());
  const failed = await h.settled(thread.id);
  assert.equal(failed.status, "failed");
  assert.equal((await h.account()).generationsUsed, 0);
  assert.equal((await h.account()).lifetimeGenerationsUsed, 0);
  assert.equal((await h.db.select().from(h.schema.generations)).length, 0);
  await h.read(thread.id);
  assert.equal((await h.account()).generationsUsed, 0);
});

test("insufficient carousel quota rejects before calling any provider", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  await h.db.update(h.schema.accounts).set({ generationsUsed: 58 });
  const thread = await h.create();
  const response = await h.request(payload(thread));
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /нужно 3, осталось 2/);
  assert.equal(h.calls(), 0); assert.equal((await h.account()).generationsUsed, 58);
});

test("timed-out carousel cannot save late results after its reservation is refunded", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  let release;
  h.setAi(() => new Promise(resolve => { release = resolve; }));
  const thread = await h.create(); await h.post(payload(thread));
  await h.db.update(h.schema.dialogueThreads).set({ updatedAt: new Date(Date.now() - 700_000).toISOString() }).where(eq(h.schema.dialogueThreads.id, thread.id));
  assert.equal((await h.read(thread.id)).thread.status, "failed");
  assert.equal((await h.account()).generationsUsed, 0);
  release(slides());
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(h.carouselCalls.length, 0);
  assert.equal((await h.db.select().from(h.schema.generations)).length, 0);
  assert.equal((await h.read(thread.id)).thread.data.cards.length, 0);
});

test("exhausting research does not block chat or charge it as research", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  await h.db.update(h.schema.accounts).set({ researchUsed: 10, generationsUsed: 60, editorActionsUsed: 100 });
  let thread = await h.create();
  await h.post(payload(thread, { mode: "chat", text: "Как начать разговор с клиентом?", settings: {} }));
  thread = await h.settled(thread.id); assert.equal(thread.status, "idle");
  const account = await h.account(); assert.equal(account.dialogueActionsUsed, 1); assert.equal(account.researchUsed, 10);
  assert.equal((await h.request(payload(thread, { mode: "topics" }))).status, 429);
});

test("another image variant receives the previous image request as context", async t => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  let thread = await h.create();
  await h.post(payload(thread, { mode: "image", text: "Нарисуй съёмку видеоподкаста в синей студии", settings: {} }));
  thread = await h.settled(thread.id);
  await h.post(payload(thread, { mode: "image", text: "Сделай ещё один вариант", settings: {} }));
  thread = await h.settled(thread.id); assert.equal(thread.status, "idle");
  assert.match(h.imageCalls[1].args[0], /видеоподкаста в синей студии/);
  assert.match(h.imageCalls[1].args[0], /Сделай ещё один вариант/);
  assert.equal((await h.account()).generationsUsed, 2);
});

test("automatic intent distinguishes generation commands from discussion and questions", () => {
  const { inferDialogueTool } = load("app/dialogue-starters.ts");
  for (const [text, mode] of [["Нарисуй студию", "image"], ["Создай карусель о съёмках", "carousel"], ["Предложи 3 темы для контента", "topics"], ["Напиши пост о свете", "text"], ["Как создать картинку?", null], ["Расскажи про карусели", null], ["Не создавай картинку", null]]) assert.equal(inferDialogueTool(text), mode, text);
});
