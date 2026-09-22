import { TONE_PLANS } from "./content-plans";

export const FORMAT_OPTIONS = [
  { value: "", label: "Авто" },
  { value: "social", label: "Пост для соцсетей" },
  { value: "seo", label: "SEO-статья" },
  { value: "ads", label: "Рекламный текст" },
  { value: "landing", label: "Текст для сайта" },
];
export const TONE_OPTIONS = [
  { value: "", label: "Авто" },
  ...Object.keys(TONE_PLANS).map((tone) => ({ value: tone, label: tone })),
];
export const LENGTH_OPTIONS = [
  { value: "", label: "Авто" },
  { value: "short", label: "Короткий" },
  { value: "medium", label: "Средний" },
  { value: "long", label: "Длинный" },
];
export const TEXT_LENGTH_TARGETS: Record<string, number> = { short: 600, medium: 1800, long: 4000 };
export const TOPIC_COUNT_OPTIONS = [3, 5, 8, 10].map((n) => ({ value: String(n), label: String(n) }));
// One option per actual output size supported by the existing image service.
export const IMAGE_ASPECT_OPTIONS = [
  { value: "1:1", label: "Квадрат" },
  { value: "4:3", label: "Альбомная" },
  { value: "9:16", label: "Портретная" },
];
export const IMAGE_FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];
export const IMAGE_KIND_OPTIONS = [
  { value: "single", label: "Одно изображение" },
  { value: "carousel", label: "Карусель" },
];
export const IMAGE_TEXT_OPTIONS = [
  { value: "auto", label: "По запросу" },
  { value: "none", label: "Без текста" },
  { value: "title", label: "Заголовок статьи" },
  { value: "custom", label: "Свой текст" },
];
export const LOGO_PLACEMENT_OPTIONS = [
  { value: "scene", label: "Вписать в сцену" },
  { value: "overlay", label: "Наложить поверх" },
];
export const LOGO_POSITION_OPTIONS = [
  { value: "bottom-right", label: "Справа внизу" },
  { value: "bottom-left", label: "Слева внизу" },
  { value: "top-right", label: "Справа вверху" },
  { value: "top-left", label: "Слева вверху" },
];
export const CAROUSEL_COUNT_OPTIONS = [3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: String(n) }));

export type GenerationSettings = {
  format: string;
  tone: string;
  length: string;
  topicCount: string;
  imageAspectRatio: string;
  imageOutputFormat: string;
  useLogo: boolean;
  imageKind: string;
  carouselSlideCount: string;
  imageTextMode?: string;
  imageText?: string;
  logoPlacement?: string;
  logoPosition?: string;
};

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  format: "", tone: "", length: "", topicCount: "5",
  imageAspectRatio: "4:3", imageOutputFormat: "png", useLogo: false,
  imageKind: "single", carouselSlideCount: "5",
  imageTextMode: "auto", imageText: "", logoPlacement: "scene", logoPosition: "bottom-right",
};

// Whitelist by task so a previous text/image selection cannot affect chat.
// /api/dialogue separately validates every value before running generation.
export function settingsForTool(tool: string, settings: Partial<GenerationSettings>, hasLogo = true) {
  if (tool === "topics") return { format: settings.format, topicCount: settings.topicCount ?? "5" };
  if (tool === "text") return { format: settings.format, tone: settings.tone, length: settings.length };
  if (tool === "topic-post") return { format: "social", tone: settings.tone, length: "short" };
  if (tool === "topic-article") return { format: "seo", tone: settings.tone, length: "long" };
  if (tool === "carousel" || tool === "image" || tool.startsWith("image-card:")) return {
    imageAspectRatio: settings.imageAspectRatio || "4:3",
    imageOutputFormat: settings.imageOutputFormat || "png",
    useLogo: hasLogo && settings.useLogo === true,
    ...(tool !== "carousel" ? {
      imageTextMode: settings.imageTextMode || "auto",
      ...(settings.imageTextMode === "custom" ? { imageText: settings.imageText?.trim() || "" } : {}),
      ...(hasLogo && settings.useLogo ? { logoPlacement: settings.logoPlacement || "scene", logoPosition: settings.logoPosition || "bottom-right" } : {}),
    } : {}),
    ...(tool === "carousel" ? { slideCount: settings.carouselSlideCount || "5" } : {}),
  };
  return {};
}
