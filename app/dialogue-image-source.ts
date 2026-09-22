import type { DialogueData } from "./dialogue-model";

export type DialogueImageSource = {
  purpose: "edit" | "reference";
  cardId?: string;
  slideIndex?: number;
  uploadUrl?: string;
};

export function dialogueImageSourceUrl(source: DialogueImageSource, data?: DialogueData) {
  if (source.uploadUrl) return source.uploadUrl;
  const card = data?.cards.find((item) => item.id === source.cardId);
  if (card?.slides?.length) return source.slideIndex === undefined ? "" : card.slides[source.slideIndex]?.imageUrl || "";
  return source.slideIndex === undefined ? card?.imageUrl || "" : "";
}

export function latestDialogueImage(data?: DialogueData): DialogueImageSource | null {
  if (!data) return null;
  for (const message of [...data.messages].reverse()) {
    if (message.role !== "assistant") continue;
    for (const id of [...(message.cardIds || [])].reverse()) {
      const card = data.cards.find((item) => item.id === id);
      // A carousel is ambiguous: the person needs to choose its actual slide.
      if (card?.slides?.length) return null;
      if (card?.imageUrl) return { cardId: id, purpose: "edit" };
    }
  }
  return null;
}
