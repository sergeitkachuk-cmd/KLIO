export const TOPICS_STARTER = "Предложи темы для контента";
export const POST_STARTER = "Помоги написать пост. Сначала уточни тему, если её недостаточно.";

// ChatKit starter prompts cannot specify a tool. Recognize only our exact
// starters on a new thread; ordinary conversation stays ordinary conversation.
export function dialogueTool(tool: string, text: string, newThread: boolean) {
  if (tool || !newThread) return tool;
  if ([TOPICS_STARTER, "Предложи пять сильных тем для контента"].includes(text.trim())) return "topics";
  if (text.trim() === POST_STARTER) return "topic-post";
  return "";
}

// Only explicit generation commands: questions about a task stay in chat.
export function inferDialogueTool(text: string): "image" | "carousel" | "topics" | "text" | null {
  const request = normalizeDialogueRequest(text);
  if (/^(создай|сделай|сгенерируй|подготовь)\s+(?:(мне|нам|еще|новую|пожалуйста)\s+)*карусел/.test(request)) return "carousel";
  if (/^нарисуй(?:\s|$)/.test(request) || /^(создай|сделай|сгенерируй|подготовь)\s+(?:(мне|нам|еще|одну|новую|другую|пожалуйста)\s+)*(картинк|изображени|иллюстраци|фото)/.test(request)) return "image";
  if (/^(предложи|подбери|придумай|сгенерируй|создай|составь)\s+(?:(мне|нам|еще|новые|несколько|\d+|пожалуйста)\s+)*(тем[уы]|идеи для (постов|контента)|контент[ -]план)/.test(request)) return "topics";
  if (/^(напиши|создай|подготовь|сгенерируй)\s+(?:(мне|нам|новый|новую|пожалуйста)\s+)*(пост(?:\s|$)|статью|текст для)/.test(request)) return "text";
  return null;
}

export function normalizeDialogueRequest(text: string) {
  return text.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
    .replace(/^(?:(?:клио|пожалуйста|слушай|скажи|а|ну|и)[,\s]+)+/, "");
}

// A mode is a shortcut for a brief, not an instruction to generate on every
// message. Only clear conversational cues override it; noun-only briefs and
// direct revision requests retain the selected tool. Never classify from a
// question mark inside a quoted headline or from words embedded in a brief.
export function isDialogueDiscussion(text: string) {
  const request = normalizeDialogueRequest(text);
  return /^(?:почему|зачем|как|что|кто|где|когда|откуда|сколько|какой|какая|какие|какое|чем|разве)\s/.test(request)
    || /^(?:(?:как|что)\s+)?(?:думаешь|считаешь)(?:[\s,.?]|$)/.test(request)
    || /^(?:можно|нужно|стоит|надо|правда|будет|можешь)\s+ли\s/.test(request)
    || /^(?:объясни|расскажи|поясни|посоветуй|обсудим|давай\s+(?:обсудим|поговорим|подумаем|разберемся)|мне\s+кажется|я\s+(?:думаю|считаю|не\s+понимаю)|может\s+(?:быть|лучше)|интересно[,\s]|не\s+(?:генерируй|рисуй|создавай|делай)\s|не\s+надо\s+(?:генерировать|рисовать|создавать))/.test(request)
    || /^(?:спасибо|благодарю|привет|здравствуй|добрый\s+(?:день|вечер)|доброе\s+утро)(?:[\s!,.?]|$)/.test(request)
    || /^(?:давай\s+)?(?:просто\s+)?(?:поговорим|пообщаемся)(?:[\s!,.?]|$)/.test(request);
}

export function isImageEditRequest(text: string) {
  if (isDialogueDiscussion(text)) return false;
  const request = normalizeDialogueRequest(text);
  return /^(?:добавь|убери|удали|замени|измени|поменяй|исправь|отредактируй|доработай|перекрась|осветли|затемни|обрежь|увеличь|уменьши|сохрани)(?:\s|$)/.test(request)
    || /^сделай\s+(?:фон|свет|цвет|логотип|его|ее|это|эту|на\s+(?:этом|этой))\s/.test(request)
    || /^(?:на|в)\s+(?:этом|этой|готовом|готовой)\s+(?:изображении|картинке|фото)/.test(request) && /(?:добавь|убери|замени|измени)/.test(request);
}

export function requestedLogoChange(text: string): boolean | null {
  if (!isImageEditRequest(text) || !/логотип|фирменн(?:ый|ого)\s+знак/.test(normalizeDialogueRequest(text))) return null;
  return !/^(?:убери|удали)/.test(normalizeDialogueRequest(text));
}

export function resolveDialogueTool(text: string, selected: string | null, requested?: string, hasImage = false) {
  // Card actions and explicitly selected ordinary chat retain their semantics.
  if (requested) return requested;
  if (selected === "chat") return "chat";
  if (isDialogueDiscussion(text)) return "chat";
  if (selected) return selected;
  return inferDialogueTool(text) || (hasImage && isImageEditRequest(text) ? "image" : "chat");
}
