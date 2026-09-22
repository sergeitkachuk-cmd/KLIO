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
  const request = text.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/^пожалуйста[,\s]+/, "");
  if (/^(создай|сделай|сгенерируй|подготовь)\s+(?:(мне|нам|еще|новую|пожалуйста)\s+)*карусел/.test(request)) return "carousel";
  if (/^нарисуй(?:\s|$)/.test(request) || /^(создай|сделай|сгенерируй|подготовь)\s+(?:(мне|нам|еще|одну|новую|другую|пожалуйста)\s+)*(картинк|изображени|иллюстраци|фото)/.test(request)) return "image";
  if (/^(предложи|подбери|придумай|сгенерируй|создай|составь)\s+(?:(мне|нам|еще|новые|несколько|\d+|пожалуйста)\s+)*(тем[уы]|идеи для (постов|контента)|контент[ -]план)/.test(request)) return "topics";
  if (/^(напиши|создай|подготовь|сгенерируй)\s+(?:(мне|нам|новый|новую|пожалуйста)\s+)*(пост(?:\s|$)|статью|текст для)/.test(request)) return "text";
  return null;
}
