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
