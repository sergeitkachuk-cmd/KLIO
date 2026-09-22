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

function chatKitRoute(dialogueRoute) {
  return load(
    "app/api/chatkit/route.ts",
    {
      "../../dialogue-model": model,
      "../dialogue/route": dialogueRoute,
      "../../dialogue-generation-settings": load("app/dialogue-generation-settings.ts", {
        "./content-plans": load("app/content-plans.ts"),
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

  const history = await request(route, {
    type: "threads.list",
    params: { limit: 20, order: "desc" },
  });
  assert.equal(history.status, 200);
  const historyPayload = await history.json();
  assert.equal(historyPayload.data.some((item) => item.id === thread.id), true);

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
