type JsonSchema = Record<string, unknown>;

type StructuredRequest = {
  schemaName: string;
  schema: JsonSchema;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  verbosity?: "low" | "medium" | "high";
};

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ИИ пока не подключён. Демонстрационные ответы отключены, чтобы КЛИО не подменяла вашу тему шаблонным текстом.");
  }
}

export class AiResponseError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function openAiConfiguration() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AiNotConfiguredError();
  return {
    apiKey,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5.6",
  };
}

export function openAiErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AiNotConfiguredError) {
    return Response.json({ error: error.message, code: "AI_NOT_CONFIGURED" }, { status: 503 });
  }
  if (error instanceof AiResponseError) {
    return Response.json({ error: error.message, code: "AI_RESPONSE_ERROR" }, { status: error.status });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}

function responseOutputText(response: unknown) {
  const source = response && typeof response === "object" ? response as Record<string, unknown> : {};
  if (typeof source.output_text === "string" && source.output_text.trim()) return source.output_text.trim();
  const output = Array.isArray(source.output) ? source.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (record.type === "refusal" && typeof record.refusal === "string") {
        throw new AiResponseError("AI‑редакция не смогла выполнить этот запрос. Измените формулировку и повторите попытку.", 422);
      }
      if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
    }
  }
  throw new AiResponseError("AI‑редакция вернула пустой ответ. Повторите попытку.");
}

export async function requestStructuredJson<T>({
  schemaName,
  schema,
  instructions,
  input,
  maxOutputTokens = 9000,
  reasoningEffort = "low",
  verbosity = "medium",
}: StructuredRequest): Promise<{ result: T; model: string }> {
  const { apiKey, model } = openAiConfiguration();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: maxOutputTokens,
      text: {
        verbosity,
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
      instructions,
      input,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("OpenAI request failed", response.status, detail.slice(0, 1200));
    throw new AiResponseError("AI‑редакция временно не ответила. Повторите попытку через несколько минут.");
  }

  const body = await response.json();
  try {
    return { result: JSON.parse(responseOutputText(body)) as T, model };
  } catch (error) {
    if (error instanceof AiResponseError) throw error;
    console.error("OpenAI structured response parse failed", error);
    throw new AiResponseError("AI‑редакция вернула неполный результат. Повторите попытку.");
  }
}
