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
  // A question about wording or a capability is conversation, even when it
  // contains a generation verb and an image noun.
  if (/[?؟]\s*$/.test(request)) return null;
  // A direct creation command must win over the currently selected shortcut.
  // This is what makes "создай картинку к тексту" work even when the user
  // forgot to open the image shortcut first.
  if (/^(?:добавь|вставь|прикрепи)\b.*\b(?:картин\w*|изображен\w*|иллюстраци\w*|фото)\b/.test(request)) return "image";
  if (/^(?:создай|сделай|сгенерируй|нарисуй|подготовь)\b.*\b(?:картин\w*|изображен\w*|иллюстраци\w*|фото)\b/.test(request)) return "image";
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

export function isMaterialEditRequest(text: string) {
  if (isDialogueDiscussion(text)) return false;
  const request = normalizeDialogueRequest(text);
  return /^(?:добавь|убери|удали|измени|замени|перепиши|отредактируй|доработай|исправь|сократи|расшири)\b/.test(request);
}

export function requestedLogoChange(text: string): boolean | null {
  const request = normalizeDialogueRequest(text);
  if (!/логотип|фирменн\p{L}*\s+знак/u.test(request)) return null;
  const logo = "(?:логотип\\p{L}*|фирменн\\p{L}*\\s+знак)";
  const start = "(?:^|\\s)";
  const negative = new RegExp(`(?:${start}без\\s+(?:\\p{L}+\\s+)?логотип\\p{L}*|${start}не\\s+(?:добавляй|добавить|используй|использовать|рисуй|рисовать|ставь|ставить|нужен)(?=\\s|$).{0,80}${logo}|${start}(?:убери|удали|убрать|удалить)(?=\\s|$).{0,40}логотип\\p{L}*|логотип\\p{L}*\\s+не\\s+нужен)`, "u");
  if (negative.test(request)) return false;
  const positive = new RegExp(`(?:${start}с\\s+(?:(?:моим|нашим|оригинальным|фирменным)\\s+)?логотип\\p{L}*|${start}(?:добавь|добавить|используй|использовать|подтяни|подтянуть|подтягивай|подтягивался|возьми|вставь|вставить|размести|поставь|приложи|прикрепи)(?=\\s|$).{0,100}${logo})`, "u");
  if (positive.test(request)) return true;
  return null;
}

export function resolveDialogueTool(text: string, selected: string | null, requested?: string, hasImage = false, hasMaterials = false, hasImageSource = false) {
  // Card actions retain their semantics, but explicit commands override a
  // stale shortcut. The old ordering made the chat shortcut swallow image
  // commands when a user forgot to switch modes manually.
  if (requested) return requested;
  const inferred = inferDialogueTool(text);
  if (inferred) return inferred;
  const normalized = normalizeDialogueRequest(text);
  const imageSpecific = /(?:изображен|картин|фото|фон|логотип|слайд|на\s+(?:этом|этой|готовом|готовой)\s+(?:изображении|картинке|фото))/.test(normalized);
  if (hasImageSource || (selected === "image" && hasImage && isImageEditRequest(text)) || (selected !== "chat" && hasImage && isImageEditRequest(text) && (!hasMaterials || imageSpecific))) return "image";
  if (hasMaterials && isMaterialEditRequest(text)) return "text";
  if (isDialogueDiscussion(text)) return "chat";
  if (selected) return selected;
  return "chat";
}
