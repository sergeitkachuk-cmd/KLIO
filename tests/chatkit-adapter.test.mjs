import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  createDialogueHarness,
  load,
  model,
} from "./helpers/dialogue-harness.mjs";

function parseEvents(body) {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

function chatKitRoute(dialogueRoute, imagePreviewSizes = async () => new Map()) {
  const carouselTemplates = load("app/carousel-templates.ts");
  return load(
    "app/api/chatkit/route.ts",
    {
      "../../dialogue-model": model,
      "../_lib/chatkit-image-preview": { imagePreviewSizes },
      "../../dialogue-starters": load("app/dialogue-starters.ts"),
      "../dialogue/route": dialogueRoute,
      "../../dialogue-generation-settings": load("app/dialogue-generation-settings.ts", {
        "./content-plans": load("app/content-plans.ts"),
        "./carousel-templates": carouselTemplates,
      }),
    },
    {
      TextEncoder,
      ReadableStream,
      URLSearchParams,
      Headers,
      setTimeout: (callback) => globalThis.setTimeout(callback, 5),
    },
  );
}

async function request(route, body, suffix = "") {
  return route.POST(
    new Request(`http://127.0.0.1:3027/api/chatkit${suffix}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("image widgets preserve actual aspect ratios in compact clickable previews", async () => {
  for (const [width, height, maxWidth] of [[1536, 1024, "420px"], [1024, 1536, "240px"], [1024, 1024, "360px"]]) {
    const card = { id: "image", title: "Image", body: "", imageUrl: "https://example.invalid/image.png", kind: "post", versions: [] };
    const route = chatKitRoute({ GET: async () => Response.json({ thread: { id: "thread", data: { cards: [card], messages: [] } } }) }, async () => new Map([[card.imageUrl, { width, height }]]));
    const response = await request(route, { type: "items.list", params: { thread_id: "thread" } });
    const widget = (await response.json()).data[0].widget;
    const image = widget.children.find((child) => child.type === "Image");
    assert.equal(image.aspectRatio, width / height);
    assert.equal(image.maxWidth, maxWidth);
    assert.equal(image.fit, "contain", "do not crop portrait or landscape originals");
    assert.equal(image.radius, "2xl");
    assert.equal(image.onClickAction.type, "klio.open_image");
    assert.deepEqual(image.onClickAction.payload, { threadId: "thread", cardId: "image" });
    assert.equal(widget.padding.top, 0);
    assert.equal(widget.gap, 2);
  }
});

test("native ChatKit history supports rename and delete without access to other owners", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const route = chatKitRoute(h.route);
  const thread = await h.create();
  const renamed = await request(route, { type: "threads.update", params: { thread_id: thread.id, title: "Название из истории" } });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).title, "Название из истории");
  h.setUser({ email: "stranger@example.com" });
  assert.equal((await request(route, { type: "threads.delete", params: { thread_id: thread.id } })).status, 404);
  h.setUser({ email: h.owner });
  assert.equal((await request(route, { type: "threads.delete", params: {} })).status, 400);
  const deleted = await request(route, { type: "threads.delete", params: { thread_id: thread.id } });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), {});
  assert.match(deleted.headers.get("cache-control"), /no-store/);
  assert.equal((await h.read(thread.id)).status, 404);
  const listed = await request(route, { type: "threads.list", params: {} });
  assert.equal((await listed.json()).data.length, 0);
});

test("ChatKit creates a real KLIO thread and returns assistant widgets", async (t) => {
  const harness = await createDialogueHarness();
  t.after(() => harness.close());
  const route = chatKitRoute(harness.route);

  const response = await request(route, {
    type: "threads.create",
    params: {
      input: {
        content: [{ type: "input_text", text: "Предложи темы" }],
        attachments: [],
        inference_options: { tool_choice: { id: "topics" } },
      },
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const events = parseEvents(await response.text());
  const created = events.find((event) => event.type === "thread.created");
  assert.ok(created?.thread.id);
  assert.equal(
    events.some(
      (event) =>
        event.type === "thread.item.done" &&
        event.item?.type === "assistant_message",
    ),
    true,
  );
  const widgets = events.filter(
    (event) =>
      event.type === "thread.item.done" && event.item?.type === "widget",
  );
  assert.equal(widgets.length, 2);
  assert.equal(widgets[0].item.widget.type, "Basic");
  const firstAction = widgets[0].item.widget.children
    .find((child) => child.type === "Row")
    ?.children.find((child) => child.onClickAction);
  assert.equal(firstAction?.onClickAction?.handler, "client");
  assert.equal(firstAction?.onClickAction?.streaming, false);
  assert.equal(firstAction?.onClickAction?.payload?.threadId, created.thread.id);
  assert.equal(
    widgets[0].item.widget.children.some(
      (child) => child.type === "Title" && child.value,
    ),
    true,
  );
  assert.equal((await harness.account()).researchUsed, 1);

  const stored = await harness.read(created.thread.id);
  assert.equal(stored.thread.data.cards.length, 2);
  assert.equal(stored.thread.data.messages[0].useBrandContext, false);
});

test("native topics starter returns actionable cards while unselected conversation stays plain chat", async (t) => {
  const harness = await createDialogueHarness();
  t.after(() => harness.close());
  const route = chatKitRoute(harness.route);
  const { TOPICS_STARTER } = load("app/dialogue-starters.ts");
  const response = await request(route, { type: "threads.create", params: {
    klio_settings: { topicCount: "8" },
    input: { content: [{ type: "input_text", text: TOPICS_STARTER }] },
  } });
  const events = parseEvents(await response.text());
  const widgets = events.filter((event) => event.type === "thread.item.done" && event.item?.type === "widget");
  assert.equal(widgets.length, 2);
  const threadId = events.find((event) => event.type === "thread.created").thread.id;
  const originalCards = (await harness.read(threadId)).thread.data.cards;
  for (const widget of widgets) {
    const actions = widget.item.widget.children.find((child) => child.type === "Row").children.map((child) => child.onClickAction);
    assert.deepEqual(actions.map((action) => action.type).sort(), ["klio.edit", "klio.save", "klio.topic_post", "klio.topic_article", "klio.topic_generator", "klio.image"].sort());
    for (const action of actions) {
      assert.equal(action.payload.threadId, threadId);
      assert.equal(action.payload.cardId, widget.item.id.slice("widget_".length));
      assert.equal(action.handler, "client");
    }
  }
  const ordinary = await request(route, { type: "threads.add_user_message", params: {
    thread_id: threadId, input: { content: [{ type: "input_text", text: "Давай просто поговорим" }] },
  } });
  const plainEvents = parseEvents(await ordinary.text());
  assert.equal(plainEvents.some((event) => event.item?.type === "widget"), false);
  assert.equal(plainEvents.some((event) => event.item?.type === "assistant_message"), true);
  const stored = (await harness.read(threadId)).thread;
  assert.deepEqual(stored.data.cards, originalCards);
  assert.equal((await harness.account()).dialogueActionsUsed, 1);
  assert.equal((await harness.account()).researchUsed, 1);
});

test("post and article topic actions enforce their format and preserve the source topic", async (t) => {
  const harness = await createDialogueHarness();
  t.after(() => harness.close());
  const route = chatKitRoute(harness.route);
  const response = await request(route, { type: "threads.create", params: {
    input: { content: [{ type: "input_text", text: "Предложи темы" }], inference_options: { tool_choice: { id: "topics" } } },
  } });
  const events = parseEvents(await response.text());
  const threadId = events.find((event) => event.type === "thread.created").thread.id;
  const original = (await harness.read(threadId)).thread.data.cards[0];
  const contexts = [];
  harness.setAi(async (input) => {
    contexts.push(JSON.parse(input.input));
    return { reply: "Готово", action: "create", cards: [{ kind: "post", title: "Новый текст", body: "Отдельный материал по теме" }], profile: [] };
  });
  for (const tool of ["topic-post", "topic-article"]) {
    const response = await request(route, { type: "threads.add_user_message", params: {
      thread_id: threadId, klio_settings: { format: "ads", length: "medium", tone: "Экспертный" },
      input: { content: [{ type: "input_text", text: original.title }], inference_options: { tool_choice: { id: tool } } },
    } });
    assert.equal(parseEvents(await response.text()).some((event) => event.type === "error"), false);
  }
  assert.equal(contexts[0].settings.format, "social");
  assert.equal(contexts[1].settings.format, "seo");
  assert.equal(contexts[0].settings.tone, "Экспертный");
  assert.ok(contexts[0].settings.target_characters_with_spaces < contexts[1].settings.target_characters_with_spaces);
  const cards = (await harness.read(threadId)).thread.data.cards;
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.find((card) => card.id === original.id), original);
});

test("ChatKit history and item paging stay on the KLIO dialogue database", async (t) => {
  const harness = await createDialogueHarness();
  t.after(() => harness.close());
  const route = chatKitRoute(harness.route);
  const thread = await harness.create();
  await harness.post({
    action: "send",
    id: thread.id,
    revision: thread.revision,
    requestId: crypto.randomUUID(),
    text: "Обычный вопрос",
    mode: "chat",
  });
  await harness.settled(thread.id);
  // Starting another conversation must not remove the first one or its data.
  const another = await harness.create();

  const history = await request(route, {
    type: "threads.list",
    params: { limit: 20, order: "desc" },
  });
  assert.equal(history.status, 200);
  const historyPayload = await history.json();
  assert.equal(historyPayload.data.some((item) => item.id === thread.id), true);
  assert.equal(historyPayload.data.some((item) => item.id === another.id), true);
  assert.equal((await harness.read(thread.id)).thread.data.messages[0].text, "Обычный вопрос");

  const items = await request(route, {
    type: "items.list",
    params: { thread_id: thread.id, limit: 1, order: "desc" },
  });
  assert.equal(items.status, 200);
  const firstPage = await items.json();
  assert.equal(firstPage.data.length, 1);
  assert.equal(firstPage.has_more, true);
  assert.equal(typeof firstPage.after, "string");

  const next = await request(route, {
    type: "items.list",
    params: {
      thread_id: thread.id,
      limit: 20,
      order: "desc",
      after: firstPage.after,
    },
  });
  const nextPage = await next.json();
  assert.equal(nextPage.data.length >= 1, true);
  assert.equal(
    [...firstPage.data, ...nextPage.data].some(
      (item) => item.type === "assistant_message",
    ),
    true,
  );
});

test("ChatKit passes text/topic settings into the real dialogue generation context", async (t) => {
  const harness = await createDialogueHarness();
  t.after(() => harness.close());
  const contexts = [];
  harness.setAi(async (input) => {
    contexts.push(JSON.parse(input.input));
    return { reply: "Готово", action: "create", cards: [{ kind: "post", title: "Материал", body: "Текст материала" }], profile: [] };
  });
  const route = chatKitRoute(harness.route);
  const thread = await harness.create();
  for (const [tool, settings] of [
    ["text", { format: "seo", tone: "Экспертный", length: "long", topicCount: 10 }],
    ["topics", { format: "social", topicCount: 8, tone: "Экспертный", length: "long" }],
  ]) {
    const response = await request(route, { type: "threads.add_user_message", params: {
      thread_id: thread.id, klio_settings: settings,
      input: { content: [{ type: "input_text", text: "Подготовь материал" }], inference_options: { tool_choice: { id: tool } } },
    } });
    const events = parseEvents(await response.text());
    assert.equal(events.some((event) => event.type === "error"), false, JSON.stringify(events));
  }
  assert.equal(contexts[0].settings.format, "seo");
  assert.equal(contexts[0].settings.tone, "Экспертный");
  assert.equal(contexts[0].settings.target_characters_with_spaces, 4000);
  assert.ok(contexts[0].settings.format_contract.rules.length);
  assert.equal(contexts[1].settings.format, "social");
  assert.equal(contexts[1].settings.topic_count, 8);
  assert.equal(contexts[1].settings.tone, null);
  assert.equal(contexts[1].settings.target_characters_with_spaces, null);
});

test("ChatKit forwards image options to the image service and rejects invalid enum values", async (t) => {
  const harness = await createDialogueHarness();
  t.after(() => harness.close());
  const route = chatKitRoute(harness.route);
  const thread = await harness.create();
  for (const settings of [
    { imageAspectRatio: "9:16", imageOutputFormat: "webp", useLogo: false },
    { imageAspectRatio: "not-a-size", imageOutputFormat: "exe", useLogo: false },
  ]) {
    const response = await request(route, { type: "threads.add_user_message", params: {
      thread_id: thread.id, klio_settings: settings,
      input: { content: [{ type: "input_text", text: "Нарисуй лес" }], inference_options: { tool_choice: { id: "image" } } },
    } });
    const events = parseEvents(await response.text());
    assert.equal(events.some((event) => event.type === "error"), false, JSON.stringify(events));
  }
  assert.equal(harness.imageCalls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.imageCalls[0].args.at(-1))), { aspectRatio: "9:16", outputFormat: "webp" });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.imageCalls[1].args.at(-1))), {});
});

test("standalone images never acquire prompt text from Materials; old duplicates stay hidden and manual edits survive", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const route = chatKitRoute(h.route);
  const prompt = "Картинку к статье на тему: Творческий рабочий процесс в студии.";
  const response = await request(route, { type: "threads.create", params: { input: {
    content: [{ type: "input_text", text: prompt }], inference_options: { tool_choice: { id: "image" } },
  } } });
  const events = parseEvents(await response.text());
  assert.equal(events.some((event) => event.type === "error"), false, JSON.stringify(events));
  const threadId = events.find((event) => event.type === "thread.created").thread.id;
  const widget = events.find((event) => event.type === "thread.item.done" && event.item?.type === "widget").item.widget;
  assert.equal(widget.children.some((node) => ["Title", "Markdown"].includes(node.type)), false);
  assert.equal(widget.children.find((node) => node.type === "Image").radius, "2xl");
  const material = (await h.db.select().from(h.schema.generations))[0];
  assert.equal(material.body, "");
  assert.equal((await h.read(threadId)).thread.data.cards[0].body, "");
  const getWidget = async () => {
    const response = await request(route, { type: "items.list", params: { thread_id: threadId, limit: 20 } });
    return (await response.json()).data.find((item) => item.type === "widget").widget;
  };
  assert.equal((await getWidget()).children.some((node) => node.type === "Markdown"), false);

  // Reproduce the previous persisted mismatch, without a database migration.
  const row = (await h.db.select().from(h.schema.dialogueThreads).where(eq(h.schema.dialogueThreads.id, threadId)))[0];
  const data = JSON.parse(row.dataJson);
  data.messages.at(-1).text = "Изображение готово и сохранено в материалы. Можно сразу подготовить публикацию или доработать карточку.";
  await h.db.update(h.schema.dialogueThreads).set({ dataJson: JSON.stringify(data) }).where(eq(h.schema.dialogueThreads.id, threadId));
  await h.db.update(h.schema.generations).set({ body: prompt }).where(eq(h.schema.generations.id, material.id));
  assert.equal((await getWidget()).children.some((node) => ["Title", "Markdown"].includes(node.type)), false);
  await h.db.update(h.schema.generations).set({ body: "Наш настоящий текст, добавленный вручную в материалах." }).where(eq(h.schema.generations.id, material.id));
  assert.equal((await getWidget()).children.find((node) => node.type === "Markdown").value, "Наш настоящий текст, добавленный вручную в материалах.");
});

test("ChatKit uses the explicit brand checkbox and passes every filled profile section to image generation", async (t) => {
  const h = await createDialogueHarness();
  t.after(() => h.close());
  const profile = {
    name: "Кинокоманда", description: "Съёмочная компания, видеопродакшн.",
    positioning: "Создаём документальные фильмы.", services: "Видеосъёмка и монтаж. Камеры, свет, микрофоны.",
    products: "Рекламные ролики", audience: "Компании", advantages: "Опытная команда",
    proof: "Фестивальные работы", geography: "Петрозаводск", vocabulary: "Съёмочная площадка",
    cta: "Обсудить съёмку", voice: "Спокойный", restrictions: "Без чужих логотипов",
    signature: "Команда студии", prohibited: "Не изображать мольберты и художников",
    logoKey: "private/storage/logo.png",
  };
  await h.db.insert(h.schema.brands).values({ id: "film", ownerEmail: h.owner, name: profile.name, profileJson: JSON.stringify(profile) });
  const route = chatKitRoute(h.route);
  const thread = await h.create("film");
  for (const enabled of [true, false]) {
    const response = await request(route, { type: "threads.add_user_message", params: {
      thread_id: thread.id, klio_brand_context: enabled,
      input: { content: [{ type: "input_text", text: "Творческий рабочий процесс в студии" }], inference_options: { tool_choice: { id: "image" } } },
    } }, enabled ? "?brandId=film" : "?brandId=film&brandContext=1");
    const events = parseEvents(await response.text());
    assert.equal(events.some((event) => event.type === "error"), false, JSON.stringify(events));
  }
  const branded = h.imageCalls[0].args[0];
  for (const [key, value] of Object.entries(profile)) if (key !== "logoKey") assert.ok(branded.includes(value), `Missing ${key}`);
  assert.equal(branded.includes(profile.logoKey), false);
  assert.match(branded, /предметный контекст/);
  assert.match(branded, /Запрос пользователя: Творческий рабочий процесс в студии/);
  assert.equal(h.imageCalls[1].args[0].includes(profile.services), false);
  assert.equal(h.imageCalls[1].args[0].includes(profile.name), false);
  assert.equal(h.calls(), 0, "normal sized profiles need no extra AI call");
});
