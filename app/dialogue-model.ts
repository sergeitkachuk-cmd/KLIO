export type DialogueCard = {
  id: string;
  kind: "post" | "topic" | "note";
  title: string;
  body: string;
  imageUrl: string;
  slides?: Array<{ headline: string; subtext: string; imageUrl: string }>;
  savedId?: string;
  savedSnapshot?: { title: string; body: string; imageUrl: string };
  versions: Array<{ title: string; body: string; imageUrl: string }>;
};
export type DialogueMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  useBrandContext?: boolean;
  mode?: string;
  imageSource?: { url: string; purpose: "edit" | "reference" };
  cardIds?: string[];
  action?: "save" | "schedule" | "image" | "profile";
  profile?: Record<string, string>;
};
export type DialogueData = {
  messages: DialogueMessage[];
  cards: DialogueCard[];
};
export type DialogueThread = {
  id: string;
  brandId: string | null;
  title: string;
  revision: number;
  status: string;
  error: string;
  updatedAt: string;
  data: DialogueData;
};
export function isStandaloneImage(thread: DialogueThread, card: DialogueCard) {
  if (card.slides?.length) return true;
  if (!card.imageUrl) return false;
  if (!card.body.trim()) return true;
  // Only recognize the exact legacy prompt duplicate. Preserve edited text.
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
export function cardSnapshot(
  card: Pick<DialogueCard, "title" | "body" | "imageUrl">,
) {
  return { title: card.title, body: card.body, imageUrl: card.imageUrl };
}
export function sameCard(
  a: ReturnType<typeof cardSnapshot>,
  b: ReturnType<typeof cardSnapshot>,
) {
  return a.title === b.title && a.body === b.body && a.imageUrl === b.imageUrl;
}
export function reviseCard(
  card: DialogueCard,
  change: Partial<Pick<DialogueCard, "title" | "body" | "imageUrl">>,
): DialogueCard {
  const next = { ...card, ...change };
  return sameCard(card, next)
    ? card
    : { ...next, versions: [...card.versions, cardSnapshot(card)].slice(-20) };
}
export function dialogueContext(data: DialogueData, selectedId: string) {
  const messages: Array<{ role: "user" | "assistant"; text: string }> = [];
  let size = 0;
  for (const message of data.messages.slice(-24).reverse()) {
    if (size + message.text.length > 60000) break;
    messages.unshift({ role: message.role, text: message.text });
    size += message.text.length;
  }
  const selected = data.cards.find((card) => card.id === selectedId) ?? null;
  // Keep the latest material bodies in the conversation context. Titles alone
  // are not enough for follow-up commands such as "добавь абзац" or
  // "добавь заголовок статьи": the model needs the article it is revising.
  // Bound each body and the total payload so a long-running thread remains
  // usable while the selected card is still available in full below.
  const materials: Array<{ id: string; kind: DialogueCard["kind"]; title: string; body: string; imageUrl: string; hasImage: boolean }> = [];
  let materialSize = 0;
  for (const card of [...data.cards].reverse()) {
    if (materials.length >= 6 || materialSize >= 30_000) break;
    const body = card.id === selected?.id ? card.body : card.body.slice(0, 6_000);
    materials.unshift({
      id: card.id,
      kind: card.kind,
      title: card.title,
      body,
      imageUrl: card.imageUrl,
      hasImage: Boolean(card.imageUrl || card.slides?.length),
    });
    materialSize += body.length + card.title.length;
  }
  return {
    messages,
    selected,
    materials,
    available: data.cards
      .map(({ id, kind, title }) => ({ id, kind, title }))
      .slice(-50),
  };
}
export const DIALOGUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", maxLength: 14000 },
    action: {
      type: "string",
      enum: ["reply", "create", "edit", "save", "schedule", "image", "profile"],
    },
    cards: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["post", "topic", "note"] },
          title: { type: "string", maxLength: 500 },
          body: { type: "string", maxLength: 30000 },
        },
        required: ["kind", "title", "body"],
      },
    },
    profile: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: {
            type: "string",
            enum: [
              "name",
              "website",
              "description",
              "positioning",
              "audience",
              "advantages",
              "products",
              "services",
              "proof",
              "geography",
              "vocabulary",
              "cta",
              "voice",
              "restrictions",
              "signature",
              "prohibited",
            ],
          },
          value: { type: "string", maxLength: 2000 },
        },
        required: ["field", "value"],
      },
    },
  },
  required: ["reply", "action", "cards", "profile"],
} as const;
export type DialogueAnswer = {
  reply: string;
  action:
    | "reply"
    | "create"
    | "edit"
    | "save"
    | "schedule"
    | "image"
    | "profile";
  cards: Array<Pick<DialogueCard, "kind" | "title" | "body">>;
  profile: Array<{ field: string; value: string }>;
};
