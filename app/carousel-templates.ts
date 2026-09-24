/**
 * Shared visual presets for carousel generation.
 *
 * The current image provider renders the final slide as a raster image, so
 * these presets are expressed as a compact art-direction contract rather than
 * a second rendering pipeline. Keeping the ids and descriptions in one place
 * lets professional mode, dialogue mode and the API use the same vocabulary.
 */
export type CarouselTemplateId = "editorial" | "gradient-pop" | "paper-light" | "terminal-dev";

export type CarouselTemplateOption = {
  value: CarouselTemplateId;
  label: string;
  description: string;
  instruction: string;
};

export const CAROUSEL_TEMPLATE_OPTIONS: readonly CarouselTemplateOption[] = [
  {
    value: "editorial",
    label: "Редакционный",
    description: "Спокойный премиальный выпуск",
    instruction: "Премиальный редакционный арт-дирекшн: как разворот современного делового журнала — выразительная предметная или репортажная фотография, естественный свет, сдержанная тёплая палитра, продуманная журнальная сетка, крупный заголовок с характерной типографикой, ясная иерархия и много воздуха. Один главный визуальный сюжет. Не делай интерфейсы приложений, плавающие карточки, дашборды, неоновые линии, техно-схемы и светящиеся абстрактные сети, если они прямо не относятся к теме.",
  },
  {
    value: "gradient-pop",
    label: "Градиентный акцент",
    description: "Ярче и заметнее в ленте",
    instruction: "Энергичный современный стиль: насыщенный, но не кислотный градиент, крупные цветовые пятна, выразительная типографика, чёткая иерархия и контрастный текст без визуального шума.",
  },
  {
    value: "paper-light",
    label: "Светлая бумага",
    description: "Лёгкий журнальный формат",
    instruction: "Светлая журнальная композиция: тёплый бумажный фон, тёмный текст, тонкие линии, мягкие тени, небольшие цветовые маркеры и ощущение печатного editorial-дизайна.",
  },
  {
    value: "terminal-dev",
    label: "Технологичный",
    description: "Сетка, данные и digital-настроение",
    instruction: "Технологичный digital-стиль: тёмная сетка, моноширинные микро-подписи, карточки данных, тонкие контуры и один холодный акцент; сохраняй крупный читаемый основной текст.",
  },
];

export const DEFAULT_CAROUSEL_TEMPLATE: CarouselTemplateId = "editorial";

export function isCarouselTemplateId(value: unknown): value is CarouselTemplateId {
  return typeof value === "string" && CAROUSEL_TEMPLATE_OPTIONS.some((option) => option.value === value);
}

export function carouselTemplateInstruction(value: unknown): string {
  const template = CAROUSEL_TEMPLATE_OPTIONS.find((option) => option.value === value)
    || CAROUSEL_TEMPLATE_OPTIONS.find((option) => option.value === DEFAULT_CAROUSEL_TEMPLATE)!;
  return template.instruction;
}

export function carouselTemplateLabel(value: unknown): string {
  const template = CAROUSEL_TEMPLATE_OPTIONS.find((option) => option.value === value)
    || CAROUSEL_TEMPLATE_OPTIONS.find((option) => option.value === DEFAULT_CAROUSEL_TEMPLATE)!;
  return template.label;
}
