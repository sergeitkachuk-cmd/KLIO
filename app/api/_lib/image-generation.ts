import { storageConfigured, uploadPublicationImage } from "./storage";

export const imageConfigured = () =>
  Boolean(storageConfigured() && (process.env.OPENAI_API_KEY?.trim() ||
    (process.env.KLIO_IMAGE_SERVICE_URL?.trim() && process.env.KLIO_IMAGE_SERVICE_TOKEN?.trim())));
export async function createImage(prompt: string, email: string, baseUrl: string, requestId: string) {
  // Browser requests only KLIO. Provider credentials and calls stay on the server;
  // image bytes are copied to our existing object store, never hotlinked to OpenAI.
  // API contract: https://developers.openai.com/api/docs/guides/image-generation
  const serviceUrl = process.env.KLIO_IMAGE_SERVICE_URL?.trim();
  const endpoint = serviceUrl ? new URL("/generate", serviceUrl) : new URL("https://api.openai.com/v1/images/generations");
  if (endpoint.protocol !== "https:") throw new Error("Сервер изображений должен использовать HTTPS.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceUrl ? process.env.KLIO_IMAGE_SERVICE_TOKEN : process.env.OPENAI_API_KEY}`,
      "Idempotency-Key": requestId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(serviceUrl ? { prompt: prompt.slice(0, 12000) } : {
      model: process.env.KLIO_IMAGE_MODEL?.trim() || "gpt-image-2.5-flare",
      prompt: prompt.slice(0, 12000),
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "png",
    }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok)
    throw new Error(
      "Сервис изображений не выполнил запрос. Попробуйте другое описание или загрузите свою картинку.",
    );
  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded || encoded.length > 12_000_000)
    throw new Error("Сервис изображений вернул некорректный файл.");
  const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
  return uploadPublicationImage(
    new File([bytes], "klio.png", { type: "image/png" }),
    email,
    baseUrl,
  );
}

