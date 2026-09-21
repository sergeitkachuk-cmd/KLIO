import test from "node:test";
import assert from "node:assert/strict";
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
