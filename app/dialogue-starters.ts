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
