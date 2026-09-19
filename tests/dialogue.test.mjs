import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDialogueHarness, model } from "./helpers/dialogue-harness.mjs";

test("card revisions preserve manual text and allow undo; context keeps the selected artifact", () => {
  const original = {
    id: "card",
    title: "Название",
    body: "Ручной текст",
    imageUrl: "",
    versions: [],
  };
  const next = model.reviseCard(original, { body: "Новый текст" });
  assert.equal(next.versions[0].body, original.body);
  assert.equal(original.body, "Ручной текст");
  const context = model.dialogueContext(
    {
      cards: [next],
      messages: Array.from({ length: 40 }, (_, i) => ({
        role: "user",
        text: String(i),
      })),
    },
    "card",
  );
  assert.equal(context.messages.length, 24);
  assert.equal(context.selected.body, "Новый текст");
});

test("dialogue API persists results, isolates owners and protects shared materials", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  let thread = await h.create();
  const send = {
    action: "send",
    id: thread.id,
    revision: thread.revision,
    requestId: randomUUID(),
    text: "Напиши пост",
  };
  const replies = await Promise.all([h.post(send), h.post(send)]);
  assert.equal(replies[0].thread.id, replies[1].thread.id);
  thread = await h.settled(thread.id);
  assert.equal(h.calls(), 1);
  assert.equal((await h.account()).editorActionsUsed, 1);
  assert.equal(thread.data.cards.length, 1);
  await h.post(send);
  assert.equal(h.calls(), 1, "replaying a completed request is free");

  let card = thread.data.cards[0];
  const saved = await h.post({
    action: "save",
    id: thread.id,
    revision: thread.revision,
    cardId: card.id,
  });
  thread = saved.thread;
  card = thread.data.cards[0];
  assert.equal(saved.generation.id, card.id);
  thread = (
    await h.post({
      action: "save",
      id: thread.id,
      revision: thread.revision,
      cardId: card.id,
    })
  ).thread;
  assert.equal(
    (await h.db.select().from(h.schema.generations)).length,
    1,
    "save does not duplicate an article",
  );

  await h.db
    .update(h.schema.generations)
    .set({ body: "Правка в профессиональном редакторе" })
    .where(eq(h.schema.generations.id, card.id));
  thread = (
    await h.post({ action: "sync", id: thread.id, revision: thread.revision })
  ).thread;
  assert.equal(
    thread.data.cards[0].body,
    "Правка в профессиональном редакторе",
  );
  thread = (
    await h.post({
      action: "edit",
      id: thread.id,
      revision: thread.revision,
      cardId: card.id,
      title: "Мой заголовок",
      body: "Ручная правка",
    })
  ).thread;
  const staleRevision = thread.revision - 1;
  assert.equal(
    (
      await h.request({
        action: "edit",
        id: thread.id,
        revision: staleRevision,
        cardId: card.id,
        title: "Потеря",
        body: "Потеря",
      })
    ).status,
    409,
  );
  await h.db
    .update(h.schema.generations)
    .set({ body: "Другая вкладка" })
    .where(eq(h.schema.generations.id, card.id));
  assert.equal(
    (
      await h.request({
        action: "save",
        id: thread.id,
        revision: thread.revision,
        cardId: card.id,
      })
    ).status,
    409,
  );
  assert.equal(
    (await h.read(thread.id)).thread.data.cards[0].body,
    "Ручная правка",
  );
  thread = (
    await h.post({
      action: "copy",
      id: thread.id,
      revision: thread.revision,
      cardId: card.id,
    })
  ).thread;
  const copy = thread.data.cards.at(-1);
  assert.notEqual(copy.id, card.id);
  assert.equal(copy.savedId, undefined);

  h.setUser({ email: "stranger@example.invalid", displayName: "Другой" });
  assert.equal((await h.read(thread.id)).status, 404);
  assert.equal(
    (
      await h.request({
        action: "save",
        id: thread.id,
        revision: thread.revision,
        cardId: card.id,
      })
    ).status,
    404,
  );
  h.setUser(null);
  assert.equal((await h.read(thread.id)).status, 401);
  assert.equal(
    (
      await h.request(
        { action: "create", id: randomUUID() },
        { origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
});

test("failed replies refund their reservation and stale workers cannot overwrite a recovered conversation", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  h.setAi(async () => {
    throw new Error("Provider unavailable");
  });
  let thread = await h.create();
  await h.post({
    action: "send",
    id: thread.id,
    revision: 0,
    requestId: randomUUID(),
    text: "Привет",
  });
  thread = await h.settled(thread.id);
  assert.equal(thread.status, "failed");
  assert.equal((await h.account()).editorActionsUsed, 0);
  let finish;
  h.setAi(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await h.post({
    action: "send",
    id: thread.id,
    revision: thread.revision,
    requestId: randomUUID(),
    text: "Ещё раз",
  });
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 5));
  await h.db
    .update(h.schema.dialogueThreads)
    .set({ updatedAt: "2000-01-01" })
    .where(eq(h.schema.dialogueThreads.id, thread.id));
  thread = (await h.read(thread.id)).thread;
  assert.equal(thread.status, "failed");
  assert.equal((await h.account()).editorActionsUsed, 0);
  finish({ reply: "Поздний ответ", action: "reply", cards: [], profile: [] });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    (await h.read(thread.id)).thread.data.messages.some(
      (m) => m.text === "Поздний ответ",
    ),
    false,
  );
});

test("profile confirmation protects manual values and post saving never silently changes a publication", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const brandId = randomUUID();
  await h.db
    .insert(h.schema.brands)
    .values({
      id: brandId,
      ownerEmail: h.owner,
      name: "Кофейня",
      profileJson: JSON.stringify({
        name: "Кофейня",
        description: "Ручное описание",
        voice: "Наш голос",
      }),
    });
  let thread = await h.create(brandId);
  h.setAi(async () => ({
    reply: "Профиль",
    action: "profile",
    cards: [],
    profile: [
      { field: "name", value: "Кофейня" },
      { field: "description", value: "ИИ-описание" },
      { field: "voice", value: "Другой голос" },
      { field: "positioning", value: "Предложение позиционирования" },
    ],
  }));
  await h.post({
    action: "send",
    mode: "profile",
    id: thread.id,
    revision: 0,
    requestId: randomUUID(),
    text: "Настрой бизнес",
  });
  thread = await h.settled(thread.id);
  const result = await h.post({
    action: "profile",
    id: thread.id,
    revision: thread.revision,
    messageId: thread.data.messages.at(-1).id,
  });
  assert.equal(result.brand.profile.description, "Ручное описание");
  assert.equal(result.brand.profile.voice, "Наш голос");
  assert.equal(
    result.brand.profile.positioning,
    "Предложение позиционирования",
  );
  thread = result.thread;
  h.setAi(async () => ({
    reply: "Готово",
    action: "create",
    cards: [{ kind: "post", title: "Пост", body: "Исходный текст" }],
    profile: [],
  }));
  await h.post({
    action: "send",
    id: thread.id,
    revision: thread.revision,
    requestId: randomUUID(),
    text: "Пост",
  });
  thread = await h.settled(thread.id);
  const card = thread.data.cards[0];
  thread = (
    await h.post({
      action: "save",
      id: thread.id,
      revision: thread.revision,
      cardId: card.id,
    })
  ).thread;
  await h.db
    .insert(h.schema.publications)
    .values({
      id: randomUUID(),
      ownerEmail: h.owner,
      brandId,
      generationId: card.id,
      channelId: "channel",
      scheduledAt: "2099-01-01",
    });
  thread = (
    await h.post({
      action: "edit",
      id: thread.id,
      revision: thread.revision,
      cardId: card.id,
      title: "Правка",
      body: "Новый текст",
    })
  ).thread;
  assert.equal(
    (
      await h.request({
        action: "save",
        id: thread.id,
        revision: thread.revision,
        cardId: card.id,
      })
    ).status,
    409,
  );
  const [article] = await h.db
    .select()
    .from(h.schema.generations)
    .where(eq(h.schema.generations.id, card.id));
  assert.equal(article.body, "Исходный текст");
});
