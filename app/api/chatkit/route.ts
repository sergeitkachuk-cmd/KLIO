import type {
  DialogueCard,
  DialogueMessage,
  DialogueThread,
} from "../../dialogue-model";
import { settingsForTool, type GenerationSettings } from "../../dialogue-generation-settings";
import { dialogueTool } from "../../dialogue-starters";
import {
  GET as dialogueGET,
  POST as dialoguePOST,
} from "../dialogue/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

type ChatKitRequest = {
  type?: string;
  params?: Record<string, unknown>;
};

type DialoguePayload = {
  thread?: DialogueThread;
  threads?: Array<Pick<DialogueThread, "id" | "title" | "updatedAt" | "status">>;
  next?: string | null;
  generation?: {
    id: string;
    title: string;
    body: string;
    imageUrl: string;
    brandId: string | null;
  };
  error?: string;
};

type ChatKitItem = Record<string, unknown> & { id: string };

class AdapterError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();
const clean = (value: unknown, max = 8000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function requestHeaders(source: Request, json = false) {
  const headers = new Headers(source.headers);
  headers.delete("content-length");
  if (json) headers.set("content-type", "application/json");
  return headers;
}

async function parseDialogueResponse(response: Response) {
  let payload: DialoguePayload = {};
  try {
    payload = (await response.json()) as DialoguePayload;
  } catch {
    throw new AdapterError("КЛИО вернула некорректный ответ.", 502);
  }
  if (!response.ok)
    throw new AdapterError(
      clean(payload.error, 1000) || "Не удалось выполнить действие.",
      response.status,
    );
  return payload;
}

async function getDialogue(
  source: Request,
  params: Record<string, string | null | undefined>,
) {
  const url = new URL("/api/dialogue", source.url);
  for (const [key, value] of Object.entries(params))
    if (value) url.searchParams.set(key, value);
  return parseDialogueResponse(
    await dialogueGET(
      new Request(url, {
        method: "GET",
        headers: requestHeaders(source),
      }),
    ),
  );
}

async function postDialogue(source: Request, body: Record<string, unknown>) {
  return parseDialogueResponse(
    await dialoguePOST(
      new Request(new URL("/api/dialogue", source.url), {
        method: "POST",
        headers: requestHeaders(source, true),
        body: JSON.stringify(body),
      }),
    ),
  );
}

function inputText(params: Record<string, unknown>) {
  const input = params.input as
    | { content?: Array<{ type?: string; text?: string; data?: unknown }> }
    | undefined;
  return (
    input?.content
      ?.filter((part) => part.type === "input_text")
      .map((part) => clean(part.text))
      .filter(Boolean)
      .join("\n") || ""
  );
}

function inputTool(params: Record<string, unknown>) {
  const input = params.input as
    | { inference_options?: { tool_choice?: { id?: string } } }
    | undefined;
  return clean(input?.inference_options?.tool_choice?.id, 160);
}

function modeAndCard(toolId: string) {
  if (toolId === "topic-post" || toolId === "topic-article") return { mode: "text", cardId: "" };
  if (toolId.startsWith("image-card:"))
    return { mode: "image", cardId: toolId.slice("image-card:".length) };
  if (toolId === "topics" || toolId === "text" || toolId === "image")
    return { mode: toolId, cardId: "" };
  return { mode: "chat", cardId: "" };
}

function isoDate(value?: string) {
  const timestamp = value && !Number.isNaN(Date.parse(value)) ? value : undefined;
  return timestamp || new Date().toISOString();
}

function imageDomains(thread: DialogueThread) {
  const domains = new Set<string>();
  for (const card of thread.data.cards) {
    if (!card.imageUrl) continue;
    try {
      domains.add(new URL(card.imageUrl).hostname);
    } catch {
      // An invalid legacy URL should not make the whole conversation unusable.
    }
  }
  return [...domains];
}

function chatThread(
  thread: DialogueThread,
  items: ChatKitItem[] = [],
) {
  const allowed = imageDomains(thread);
  return {
    id: thread.id,
    title: thread.title || "Новый диалог",
    created_at: isoDate(thread.updatedAt),
    status: { type: "active" },
    ...(allowed.length ? { allowed_image_domains: allowed } : {}),
    items: { data: items, has_more: false },
  };
}

function userItem(
  threadId: string,
  message: DialogueMessage,
  createdAt: string,
) {
  return {
    id: message.id,
    thread_id: threadId,
    created_at: createdAt,
    type: "user_message",
    content: [{ type: "input_text", text: message.text }],
    attachments: [],
    inference_options: { tool_choice: null, model: null },
  };
}

function assistantItem(
  threadId: string,
  message: DialogueMessage,
  createdAt: string,
) {
  return {
    id: message.id,
    thread_id: threadId,
    created_at: createdAt,
    type: "assistant_message",
    content: [
      {
        type: "output_text",
        text: message.text || "Готово.",
        annotations: [],
      },
    ],
  };
}

function clientAction(type: string, threadId: string, cardId: string) {
  return {
    type,
    payload: { threadId, cardId },
    handler: "client",
    loadingBehavior: "none",
    streaming: false,
  };
}

function isStandaloneImage(thread: DialogueThread, card: DialogueCard) {
  if (!card.imageUrl) return false;
  if (!card.body.trim()) return true;
  // Old standalone images were saved with their prompt as material body,
  // then refreshed into the chat. Hide only that exact, unedited duplicate;
  // never hide a real post or text subsequently edited in Materials.
  if (card.versions.length) return false;
  const index = thread.data.messages.findIndex((message) =>
    message.role === "assistant"
    && message.text === "Изображение готово и сохранено в материалы. Можно сразу подготовить публикацию или доработать карточку."
    && message.cardIds?.includes(card.id));
  const request = thread.data.messages[index - 1];
  return request?.role === "user"
    && card.title === request.text.slice(0, 100)
    && card.body === request.text.slice(0, 4000);
}

function cardWidget(
  thread: DialogueThread,
  card: DialogueCard,
  createdAt: string,
) {
  const pureImage = isStandaloneImage(thread, card);
  const children: Array<Record<string, unknown>> = [];
  if (!pureImage) {
    children.push({
      type: "Title",
      value: card.title,
      size: "sm",
      weight: "semibold",
    });
    children.push({ type: "Markdown", value: card.body });
  }
  if (card.imageUrl)
    children.push({
      type: "Image",
      src: card.imageUrl,
      alt: card.title || "Изображение КЛИО",
      fit: "contain",
      radius: "2xl",
      width: "100%",
    });

  const buttons: Array<Record<string, unknown>> = [];
  if (pureImage) {
    buttons.push({
      type: "Button",
      label: "Открыть",
      iconStart: "external-link",
      variant: "outline",
      onClickAction: clientAction("klio.open_image", thread.id, card.id),
    });
  } else {
    buttons.push({
      type: "Button",
      label: "Редактировать",
      iconStart: "write",
      variant: "outline",
      onClickAction: clientAction("klio.edit", thread.id, card.id),
    });
  }
  buttons.push({
    type: "Button",
    label: card.savedId ? "Сохранено" : "В материалы",
    iconStart: card.savedId ? "check" : "book-open",
    variant: "outline",
    disabled: Boolean(card.savedId),
    onClickAction: clientAction("klio.save", thread.id, card.id),
  });

  if (card.kind === "topic") {
    buttons.push({
      type: "Button",
      label: "Пост",
      iconStart: "square-text",
      variant: "soft",
      onClickAction: clientAction("klio.topic_post", thread.id, card.id),
    });
    buttons.push({
      type: "Button", label: "Статья", iconStart: "document", variant: "soft",
      onClickAction: clientAction("klio.topic_article", thread.id, card.id),
    });
    buttons.push({
      type: "Button", label: "В генератор", iconStart: "external-link", variant: "outline",
      onClickAction: clientAction("klio.topic_generator", thread.id, card.id),
    });
  }
  if (!pureImage) {
    buttons.push({
      type: "Button",
      label: "Создать картинку",
      iconStart: "square-image",
      variant: "soft",
      onClickAction: clientAction("klio.image", thread.id, card.id),
    });
  }
  if (card.kind !== "topic" || pureImage) {
    buttons.push({
      type: "Button",
      label: "В публикацию",
      iconStart: "calendar",
      variant: "soft",
      onClickAction: clientAction("klio.publish", thread.id, card.id),
    });
  }

  children.push({ type: "Row", gap: 2, wrap: "wrap", children: buttons });
  return {
    id: `widget_${card.id}`,
    thread_id: thread.id,
    created_at: createdAt,
    type: "widget",
    copy_text: pureImage ? undefined : `${card.title}\n\n${card.body}`,
    widget: {
      type: "Basic",
      direction: "col",
      gap: 3,
      padding: { top: 2, right: 0, bottom: 4, left: 0 },
      children,
    },
  };
}

function threadItems(thread: DialogueThread) {
  const cards = new Map(thread.data.cards.map((card) => [card.id, card]));
  const items: ChatKitItem[] = [];
  const usedCards = new Set<string>();
  const createdAt = isoDate(thread.updatedAt);
  for (const message of thread.data.messages) {
    items.push(
      message.role === "user"
        ? userItem(thread.id, message, createdAt)
        : assistantItem(thread.id, message, createdAt),
    );
    for (const cardId of message.cardIds || []) {
      const card = cards.get(cardId);
      if (!card || usedCards.has(card.id)) continue;
      usedCards.add(card.id);
      items.push(cardWidget(thread, card, createdAt));
    }
  }
  for (const card of thread.data.cards) {
    if (usedCards.has(card.id)) continue;
    items.push(cardWidget(thread, card, createdAt));
  }
  return items;
}

function pageItems(
  items: ChatKitItem[],
  params: Record<string, unknown>,
) {
  const order = params.order === "asc" ? "asc" : "desc";
  const ordered = order === "asc" ? items : [...items].reverse();
  const offset = Math.max(0, Number.parseInt(clean(params.after, 20), 10) || 0);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(params.limit ?? 20), 10) || 20),
  );
  const data = ordered.slice(offset, offset + limit);
  const next = offset + data.length;
  return {
    data,
    has_more: next < ordered.length,
    ...(next < ordered.length ? { after: String(next) } : {}),
  };
}

function emit(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: Record<string, unknown>,
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

async function waitForDialogue(source: Request, id: string) {
  const deadline = Date.now() + 210_000;
  while (Date.now() < deadline) {
    const payload = await getDialogue(source, { id });
    if (!payload.thread)
      throw new AdapterError("Диалог не найден после отправки.", 502);
    if (payload.thread.status !== "processing") {
      if (payload.thread.error)
        throw new AdapterError(payload.thread.error, 502);
      return payload.thread;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new AdapterError(
    "КЛИО готовит ответ дольше обычного. Сообщение сохранено — откройте диалог чуть позже.",
    504,
  );
}

async function streamMessage(
  source: Request,
  request: ChatKitRequest,
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  const params = request.params || {};
  const url = new URL(source.url);
  const brandId = clean(url.searchParams.get("brandId"), 100);
  const useBrandContext = typeof params.klio_brand_context === "boolean"
    ? params.klio_brand_context
    : url.searchParams.get("brandContext") === "1";
  const text = inputText(params);
  if (!text) throw new AdapterError("Напишите сообщение.", 400);

  let before: DialogueThread;
  if (request.type === "threads.create") {
    const id = crypto.randomUUID();
    const created = await postDialogue(source, {
      action: "create",
      id,
      brandId,
    });
    if (!created.thread)
      throw new AdapterError("Не удалось создать диалог.", 502);
    before = created.thread;
    emit(controller, {
      type: "thread.created",
      thread: chatThread(before),
    });
  } else {
    const id = clean(params.thread_id, 100);
    if (!id) throw new AdapterError("Диалог не выбран.", 400);
    const loaded = await getDialogue(source, { id });
    if (!loaded.thread) throw new AdapterError("Диалог не найден.", 404);
    before = loaded.thread;
  }

  const requestId = crypto.randomUUID();
  const tool = dialogueTool(inputTool(params), text, request.type === "threads.create");
  const { mode, cardId } = modeAndCard(tool);
  const incoming: DialogueMessage = {
    id: requestId,
    role: "user",
    text,
    useBrandContext,
  };
  emit(controller, {
    type: "thread.item.done",
    item: userItem(before.id, incoming, new Date().toISOString()),
  });
  emit(controller, {
    type: "stream_options",
    stream_options: { allow_cancel: false },
  });
  emit(controller, {
    type: "progress_update",
    icon: "sparkle",
    text: mode === "image" ? "КЛИО создаёт изображение" : "КЛИО готовит ответ",
  });

  const accepted = await postDialogue(source, {
    action: "send",
    id: before.id,
    revision: before.revision,
    requestId,
    text,
    mode,
    cardId,
    useBrandContext,
    settings: settingsForTool(tool, (
      params.klio_settings && typeof params.klio_settings === "object" && !Array.isArray(params.klio_settings)
        ? params.klio_settings : {}
    ) as Partial<GenerationSettings>),
  });
  if (!accepted.thread)
    throw new AdapterError("КЛИО не приняла сообщение.", 502);

  const final = await waitForDialogue(source, before.id);
  const oldMessageIds = new Set(before.data.messages.map((message) => message.id));
  const newMessages = final.data.messages.filter(
    (message) => !oldMessageIds.has(message.id) && message.role === "assistant",
  );
  const allItems = threadItems(final);
  const newMessageIds = new Set(newMessages.map((message) => message.id));
  const newCardIds = new Set(newMessages.flatMap((message) => message.cardIds || []));
  // Publish the final metadata before image widgets so ChatKit knows which
  // remote image domains are allowed when it renders those widgets.
  emit(controller, {
    type: "thread.updated",
    thread: chatThread(final),
  });
  for (const item of allItems) {
    const rawId = item.id.startsWith("widget_") ? item.id.slice(7) : item.id;
    if (newMessageIds.has(item.id) || newCardIds.has(rawId))
      emit(controller, { type: "thread.item.done", item });
  }
}

function streamingResponse(source: Request, request: ChatKitRequest) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamMessage(source, request, controller);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Не удалось получить ответ КЛИО.";
        emit(controller, {
          type: "error",
          code: "custom",
          message,
          allow_retry: true,
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

async function nonStreamingResponse(
  source: Request,
  request: ChatKitRequest,
) {
  const params = request.params || {};
  const url = new URL(source.url);
  const brandId = clean(url.searchParams.get("brandId"), 100);
  if (request.type === "threads.list") {
    const payload = await getDialogue(source, {
      brandId,
      before: clean(params.after, 100),
    });
    return Response.json(
      {
        data: (payload.threads || []).map((thread) => ({
          id: thread.id,
          title: thread.title || "Новый диалог",
          created_at: isoDate(thread.updatedAt),
          status: { type: "active" },
        })),
        has_more: Boolean(payload.next),
        ...(payload.next ? { after: payload.next } : {}),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  }
  if (request.type === "threads.get_by_id" || request.type === "items.list") {
    const id = clean(params.thread_id, 100);
    const payload = await getDialogue(source, { id });
    if (!payload.thread) throw new AdapterError("Диалог не найден.", 404);
    const items = threadItems(payload.thread);
    return Response.json(
      request.type === "threads.get_by_id"
        ? chatThread(payload.thread, items)
        : pageItems(items, params),
      { headers: { "cache-control": "private, no-store" } },
    );
  }
  if (request.type === "threads.update") {
    const id = clean(params.thread_id, 100);
    const loaded = await getDialogue(source, { id });
    if (!loaded.thread) throw new AdapterError("Диалог не найден.", 404);
    const updated = await postDialogue(source, {
      action: "rename",
      id,
      revision: loaded.thread.revision,
      title: clean(params.title, 80),
    });
    if (!updated.thread) throw new AdapterError("Диалог не найден.", 404);
    return Response.json(chatThread(updated.thread), {
      headers: { "cache-control": "private, no-store" },
    });
  }
  if (request.type === "items.feedback") return Response.json({});
  throw new AdapterError("Эта операция ChatKit пока не поддерживается.", 400);
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 120_000)
      throw new AdapterError("Запрос слишком большой.", 413);
    const body = JSON.parse(raw) as ChatKitRequest;
    if (
      body.type === "threads.create" ||
      body.type === "threads.add_user_message"
    )
      return streamingResponse(request, body);
    return await nonStreamingResponse(request, body);
  } catch (error) {
    const status = error instanceof AdapterError ? error.status : 400;
    const message =
      error instanceof Error ? error.message : "Некорректный запрос ChatKit.";
    return Response.json({ error: message }, { status });
  }
}
