import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDialogueHarness, model } from "./helpers/dialogue-harness.mjs";

test("dialogue history traverses identical timestamps without losing rows or crossing brands", async (t) => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  const rows = Array.from({ length: 44 }, () => ({ id: randomUUID(), ownerEmail: h.owner, updatedAt: "2026-09-22T00:00:00.000Z", title: "Conversation" }));
  await h.db.insert(h.schema.dialogueThreads).values(rows);
  await h.db.insert(h.schema.dialogueThreads).values({ id: randomUUID(), ownerEmail: "another@example.com", updatedAt: rows[0].updatedAt });
  const first = await (await h.route.GET(new Request("http://127.0.0.1:3027/api/dialogue"))).json();
  const second = await (await h.route.GET(new Request(`http://127.0.0.1:3027/api/dialogue?before=${encodeURIComponent(first.next)}`))).json();
  assert.equal(first.threads.length, 40); assert.equal(second.threads.length, 4); assert.equal(second.next, null);
  assert.equal(new Set([...first.threads, ...second.threads].map((row) => row.id)).size, 44);
  assert.equal((await h.route.GET(new Request("http://127.0.0.1:3027/api/dialogue?before=broken"))).status, 400);
});

test("rename and delete protect ownership, revisions and shared materials", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  let thread = await h.create();
  const other = await h.create();
  const initialRevision = thread.revision;
  const empty = await h.request({ action: "rename", id: thread.id, revision: thread.revision, title: "   " });
  assert.equal(empty.status, 400);
  thread = (await h.post({ action: "rename", id: thread.id, revision: thread.revision, title: "  Рабочий диалог  " })).thread;
  assert.equal(thread.title, "Рабочий диалог");
  assert.equal(thread.revision, initialRevision + 1);
  assert.equal((await h.request({ action: "delete", id: thread.id, revision: initialRevision })).status, 409);
  h.setUser({ email: "another@example.com" });
  for (const action of ["rename", "delete"]) assert.equal((await h.request({ action, id: thread.id, revision: thread.revision, title: "Чужой" })).status, 404);
  h.setUser({ email: h.owner });
  assert.equal((await h.request({ action: "delete", id: thread.id, revision: thread.revision }, { origin: "https://evil.invalid" })).status, 403);
  await h.db.update(h.schema.dialogueThreads).set({ status: "processing" }).where(eq(h.schema.dialogueThreads.id, thread.id));
  assert.equal((await h.request({ action: "delete", id: thread.id, revision: thread.revision })).status, 409);
  await h.db.update(h.schema.dialogueThreads).set({ status: "idle" }).where(eq(h.schema.dialogueThreads.id, thread.id));
  await h.post({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), text: "Нарисуй лес", mode: "image" });
  thread = await h.settled(thread.id);
  const materials = await h.db.select().from(h.schema.generations);
  assert.equal(materials.length, 1);
  assert.ok(materials[0].imageUrl);
  const account = await h.account();
  assert.equal((await h.post({ action: "delete", id: thread.id, revision: thread.revision })).deletedId, thread.id);
  assert.equal((await h.read(thread.id)).status, 404);
  assert.equal((await h.read(other.id)).status, 200);
  assert.deepEqual(await h.db.select().from(h.schema.generations), materials);
  assert.deepEqual(await h.account(), account);
  assert.equal((await h.request({ action: "delete", id: thread.id, revision: thread.revision })).status, 404);
});

test("brand context is off by default even when a business is selected", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  await h.db.insert(h.schema.brands).values({ id: "coffee-brand", ownerEmail: h.owner, name: "Кофейня", profileJson: JSON.stringify({ name: "Кофейня", audience: "Гости" }) });
  let sent;
  h.setAi(async input => { sent = JSON.parse(input.input); return { reply: "Готово", action: "reply", cards: [], profile: [] }; });
  const thread = await h.create("coffee-brand");
  await h.post({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), text: "Расскажи про космос" });
  const settled = await h.settled(thread.id);
  assert.equal(sent.brandContextEnabled, false);
  assert.deepEqual(sent.profile, {});
  assert.equal(settled.data.messages[0].useBrandContext, false);
  assert.equal(settled.brandId, "coffee-brand");
});

test("web search runs automatically for fact-seeking questions and stays off for ordinary chat", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  let thread = await h.create();
  let sent;
  let lastTavilyCall;
  let tavilyCalls = 0;
  h.setAi(async input => { sent = JSON.parse(input.input); return { raw: "Готово" }; });
  h.setTavily(async (topic, recent) => { tavilyCalls++; lastTavilyCall = { topic, recent }; return { query: topic, results: [{ title: "ГОСТ 31805-2012", url: "https://example.invalid/gost", content: "Требования к упаковке." }] }; });
  const send = async (text) => {
    await h.post({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), text, mode: "chat" });
    thread = await h.settled(thread.id);
  };

  await send("Помоги придумать пост про уютную атмосферу кофейни");
  assert.equal(tavilyCalls, 0);
  assert.equal(sent.searchAttempted, false);
  assert.equal(sent.research, null);

  // A standard/GOST lookup is a fact question, not a recency one - the
  // current standard can genuinely be a decade-old document, so this must
  // NOT get time-scoped the way a news question does below.
  await send("Какой ГОСТ регулирует упаковку кофе?");
  assert.equal(tavilyCalls, 1);
  assert.equal(sent.searchAttempted, true);
  assert.equal(sent.research.results[0].title, "ГОСТ 31805-2012");
  assert.equal(lastTavilyCall.recent, false);

  // "что изменилось" is exactly the site owner's own "не старые из памяти"
  // complaint - must trigger the recency-biased search, not just any search.
  await send("Что изменилось в правилах маркировки за последний месяц?");
  assert.equal(tavilyCalls, 2);
  assert.equal(lastTavilyCall.recent, true);
});

test("image generation from dialogue saves the result into materials", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  let thread = await h.create();
  h.setAi(async (input) => {
    const context = JSON.parse(input.input);
    const text = context.messages.at(-1).text;
    if (/пост/i.test(text)) {
      return {
        reply: "Пост готов.",
        action: "create",
        cards: [{ kind: "post", title: "Полное название ".repeat(10), body: "Основной текст поста. ".repeat(250) }],
        profile: [],
      };
    }
    return { reply: "Готово", action: "reply", cards: [], profile: [] };
  });
  await h.post({
    action: "send",
    id: thread.id,
    revision: thread.revision,
    requestId: randomUUID(),
    text: "Напиши пост",
    mode: "text",
  });
  thread = await h.settled(thread.id);
  const card = thread.data.cards[0];

  await h.post({
    action: "send",
    id: thread.id,
    revision: thread.revision,
    cardId: card.id,
    requestId: randomUUID(),
    text: "Сделай картинку к посту",
    mode: "image",
  });

  const saved = await h.settled(thread.id);
  const materials = await h.db.select().from(h.schema.generations);
  assert.equal(materials.some((item) => item.topic === "Изображение" && item.imageUrl.includes("generated.png")), true);
  assert.equal(saved.data.cards.some((item) => item.id === card.id && item.imageUrl.includes("generated.png")), true);
  assert.equal(materials[0].title, card.title);
  assert.equal(materials[0].body, card.body);
  assert.equal(saved.data.cards[0].body, card.body);
});

test("large image profiles are read in full before a bounded brief; invalid briefs refund quota without generating", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const profile = { description: "Видеопроизводство. ".repeat(160), services: "Съёмка документальных фильмов. ".repeat(100), advantages: "Опыт в сложных проектах. ".repeat(140), products: "Видеоролики и видеоподкасты. ".repeat(100), prohibited: "Последнее ограничение: без кистей и мольбертов." };
  await h.db.insert(h.schema.brands).values({ id: "large", ownerEmail: h.owner, name: "Кинокоманда", profileJson: JSON.stringify(profile) });
  let seen;
  h.setAi(async (input) => { seen = input; return { raw: "Творческая работа съёмочной группы в студии видеопроизводства: камера, свет, режиссёр. Без кистей и мольбертов." }; });
  let thread = await h.create("large");
  const send = async () => {
    await h.post({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), text: "Процесс в студии", mode: "image", useBrandContext: true });
    thread = await h.settled(thread.id);
  };
  await send();
  assert.equal(thread.status, "idle");
  assert.equal(seen.operation, "dialogue_plain");
  for (const value of Object.values(profile)) assert.ok(seen.input.includes(value.trim()));
  assert.match(seen.input, /Запрос пользователя: Процесс в студии$/);
  assert.ok(h.imageCalls[0].args[0].length <= 11000);
  assert.match(h.imageCalls[0].args[0], /видеопроизводства/);
  const used = (await h.account()).generationsUsed;
  h.setAi(async () => ({ raw: "x".repeat(12000) }));
  await send();
  assert.equal(thread.status, "failed");
  assert.equal(h.imageCalls.length, 1);
  assert.equal((await h.account()).generationsUsed, used);
});

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
    mode: "text",
  };
  const replies = await Promise.all([h.post(send), h.post(send)]);
  assert.equal(replies[0].thread.id, replies[1].thread.id);
  thread = await h.settled(thread.id);
  assert.equal(h.calls(), 1);
  assert.equal((await h.account()).generationsUsed, 1);
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
    mode: "chat",
  });
  thread = await h.settled(thread.id);
  assert.equal(thread.status, "failed");
  assert.equal((await h.account()).dialogueActionsUsed, 0);
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
    mode: "chat",
  });
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 5));
  await h.db
    .update(h.schema.dialogueThreads)
    .set({ updatedAt: "2000-01-01" })
    .where(eq(h.schema.dialogueThreads.id, thread.id));
  thread = (await h.read(thread.id)).thread;
  assert.equal(thread.status, "failed");
  assert.equal((await h.account()).dialogueActionsUsed, 0);
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
    mode: "text",
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

test("each dialogue intent debits the pool matching what it actually produces", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  let thread = await h.create();
  const send = async (mode, text) => {
    await h.post({
      action: "send",
      id: thread.id,
      revision: thread.revision,
      requestId: randomUUID(),
      text,
      mode,
    });
    thread = await h.settled(thread.id);
  };

  // "topics" - a topic-ideation list, the same thing professional mode's
  // own content-plan generation already debits research for.
  await send("topics", "Нужны темы для постов");
  assert.deepEqual(
    (({ researchUsed, generationsUsed, editorActionsUsed, dialogueActionsUsed }) =>
      ({ researchUsed, generationsUsed, editorActionsUsed, dialogueActionsUsed }))(await h.account()),
    { researchUsed: 1, generationsUsed: 0, editorActionsUsed: 0, dialogueActionsUsed: 0 },
  );

  // "image" - unchanged from before this rework, still the generation pool.
  await send("image", "Нарисуй логотип");
  assert.equal((await h.account()).generationsUsed, 1);

  // "chat" - plain advice/discussion, no content produced - its own pool,
  // never editorActionsUsed (that stays exclusively the professional
  // mode's own AI-editor tool from here on).
  await send("chat", "Как лучше вести соцсети кофейни?");
  const after = await h.account();
  assert.equal(after.dialogueActionsUsed, 1);
  assert.equal(after.editorActionsUsed, 0);
});

test("ordinary chat requests plain text directly without a card schema", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  h.setAi(async (input) => {
    assert.equal(input.operation, "dialogue_plain");
    assert.equal(input.schema, undefined);
    return { raw: "КЛИО отвечает на обычный вопрос." };
  });
  let thread = await h.create();
  await h.post({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), text: "Расскажи, как составить план на неделю", mode: "chat" });
  thread = await h.settled(thread.id);
  assert.equal(thread.status, "idle");
  assert.equal(thread.data.messages.at(-1).text, "КЛИО отвечает на обычный вопрос.");
  assert.equal(thread.data.cards.length, 0);
  assert.equal((await h.account()).dialogueActionsUsed, 1);
  assert.equal(h.calls(), 1);
});

test("chat stays available when GPT returns a regional 403", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const operations = [];
  h.setAi(async (input) => {
    operations.push(input.operation);
    if (input.operation === "dialogue_plain") throw new h.AiCallError("OpenAI returned 403", 403);
    return { raw: "Ответ через резервный текстовый маршрут." };
  });
  let thread = await h.create();
  await h.post({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), text: "Привет", mode: "chat" });
  thread = await h.settled(thread.id);
  assert.equal(thread.status, "idle");
  assert.equal(thread.data.messages.at(-1).text, "Ответ через резервный текстовый маршрут.");
  assert.deepEqual(operations, ["dialogue_plain", "dialogue_deepseek_plain"]);
  assert.equal((await h.account()).dialogueActionsUsed, 1);
});
