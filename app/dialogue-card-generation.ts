import type { DialogueCard } from "./dialogue-model";
import { FORMAT_OPTIONS, IMAGE_STYLE_OPTIONS, settingsForTool, type GenerationSettings } from "./dialogue-generation-settings";

export type CardGenerationKind = "text" | "image";
export type CardGenerationChoices = { settings: GenerationSettings; useBrandContext: boolean; imageStyle?: string };
export const CARD_IMAGE_STYLES = IMAGE_STYLE_OPTIONS;

// Card buttons propose defaults; the confirmed choices are the request contract.
// Do not run them through topic-post/article shortcuts that force a hidden size.
export function cardGenerationDefaults(action: string, current: GenerationSettings): GenerationSettings {
  if (action === "klio.image") return { ...current, imageKind: "single", imageTextMode: !current.imageTextMode || current.imageTextMode === "auto" ? "none" : current.imageTextMode };
  return {
    ...current,
    format: action === "klio.topic_article" ? "seo" : "social",
    length: current.length || (action === "klio.topic_article" ? "long" : "medium"),
  };
}

export function cardGenerationRequest(
  kind: CardGenerationKind,
  card: Pick<DialogueCard, "id" | "title" | "body">,
  choices: CardGenerationChoices,
  brand: { id: string; name: string; hasLogo: boolean },
) {
  const useBrandContext = Boolean(brand.id) && choices.useBrandContext;
  const source = `«${card.title.slice(0, 500)}».\n${card.body.slice(0, 6000)}`;
  const imageStyle = CARD_IMAGE_STYLES.find(style => style.value === choices.imageStyle)?.instruction;
  const brandInstruction = useBrandContext
    ? `\nИспользуй полный профиль выбранного бренда «${brand.name.slice(0, 250)}»: его сферу, аудиторию, факты и голос. Не выдумывай отсутствующие сведения.`
    : "\nПрофиль бренда не использовать.";
  const text = kind === "image"
    ? `Создай изображение для этого материала: ${source}${brandInstruction}${imageStyle ? `\nСтиль изображения: ${imageStyle}` : ""}\nИсходную карточку материала сохрани без изменений. Надписи на изображении определяются выбранными параметрами.`
    : `Создай отдельный готовый материал. Формат: ${FORMAT_OPTIONS.find(option => option.value === choices.settings.format)?.label || "по смыслу темы"}. Тема: ${source}${brandInstruction}\nИсходную карточку темы сохрани без изменений. Создай новую карточку с полным текстом.`;
  return {
    text,
    options: {
      mode: kind,
      ...(kind === "image" ? { cardId: card.id } : {}),
      useBrandContext,
      settings: settingsForTool(kind, choices.settings, brand.hasLogo),
    },
  };
}
