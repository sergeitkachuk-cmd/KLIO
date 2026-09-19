import { storageConfigured, uploadPublicationImage } from "./storage";

export type ImageAspectRatio = "1:1" | "4:3" | "4:5" | "16:9" | "9:16";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageQuality = "low" | "medium" | "high";
export type ImageGenerationOptions = {
  size?: string;
  aspectRatio?: ImageAspectRatio;
  quality?: ImageQuality;
  outputFormat?: ImageOutputFormat;
  background?: "auto" | "transparent" | "opaque";
};

// gpt-image-1 only accepts three literal size values - "1024x1024",
// "1536x1024" or "1024x1536" (or "auto") - not an arbitrary WxH per aspect
// ratio. Sending "1536x1152"/"1024x1280"/"1536x864" (site owner: image
// generation broke right after adding this aspect-ratio picker) made
// OpenAI reject the request outright for 4:3/4:5/16:9 - every ratio except
// the two that happened to already be exact matches (1:1, 9:16). Each
// requested ratio now snaps to the nearest of the three real sizes.
const IMAGE_SIZE_BY_RATIO: Record<ImageAspectRatio, string> = {
  "1:1": "1024x1024",
  "4:3": "1536x1024",
  "16:9": "1536x1024",
  "4:5": "1024x1536",
  "9:16": "1024x1536",
};

// Narrows raw request-body values (typeof-checked strings, but not yet
// known to be one of the accepted union members) into ImageGenerationOptions.
// An unrecognized value silently becomes undefined here rather than a
// validation error - resolveImageGenerationOptions below already falls
// back to sane defaults for anything missing, so a typo/garbage value from
// the client just gets the default treatment instead of a 400.
export function parseImageGenerationOptions(input: Record<string, unknown>): ImageGenerationOptions {
  const aspectRatio = typeof input.aspectRatio === "string" && (["1:1", "4:3", "4:5", "16:9", "9:16"] as const).includes(input.aspectRatio as ImageAspectRatio)
    ? (input.aspectRatio as ImageAspectRatio) : undefined;
  const quality = typeof input.quality === "string" && (["low", "medium", "high"] as const).includes(input.quality as ImageQuality)
    ? (input.quality as ImageQuality) : undefined;
  const outputFormat = typeof input.outputFormat === "string" && (["png", "jpeg", "webp"] as const).includes(input.outputFormat as ImageOutputFormat)
    ? (input.outputFormat as ImageOutputFormat) : undefined;
  const background = typeof input.background === "string" && (["auto", "transparent", "opaque"] as const).includes(input.background as "auto" | "transparent" | "opaque")
    ? (input.background as "auto" | "transparent" | "opaque") : undefined;
  return {
    size: typeof input.size === "string" ? input.size : undefined,
    aspectRatio,
    quality,
    outputFormat,
    background,
  };
}

export function resolveImageGenerationOptions(options: ImageGenerationOptions = {}) {
  const ratio = options.aspectRatio && IMAGE_SIZE_BY_RATIO[options.aspectRatio] ? options.aspectRatio : "4:3";
  const size = options.size && /^\d+x\d+$/.test(options.size) ? options.size : IMAGE_SIZE_BY_RATIO[ratio];
  const quality = options.quality && ["low", "medium", "high"].includes(options.quality) ? options.quality : "medium";
  const outputFormat = options.outputFormat && ["png", "jpeg", "webp"].includes(options.outputFormat) ? options.outputFormat : "png";
  const background = options.background && ["auto", "transparent", "opaque"].includes(options.background) ? options.background : "auto";

  return {
    aspectRatio: ratio,
    size,
    quality,
    outputFormat,
    background,
  };
}

export const imageConfigured = () =>
  Boolean(storageConfigured() && (process.env.OPENAI_API_KEY?.trim() ||
    (process.env.KLIO_IMAGE_SERVICE_URL?.trim() && process.env.KLIO_IMAGE_SERVICE_TOKEN?.trim())));
export async function createImage(prompt: string, email: string, baseUrl: string, requestId: string, options: ImageGenerationOptions = {}) {
  // Browser requests only KLIO. Provider credentials and calls stay on the server;
  // image bytes are copied to our existing object store, never hotlinked to OpenAI.
  // API contract: https://developers.openai.com/api/docs/guides/image-generation
  const serviceUrl = process.env.KLIO_IMAGE_SERVICE_URL?.trim();
  const endpoint = serviceUrl ? new URL("/generate", serviceUrl) : new URL("https://api.openai.com/v1/images/generations");
  if (endpoint.protocol !== "https:") throw new Error("Сервер изображений должен использовать HTTPS.");
  const resolved = resolveImageGenerationOptions(options);
  const imageRequest = serviceUrl ? {
    prompt: prompt.slice(0, 12000),
    ...(options.size || options.aspectRatio ? { size: resolved.size, aspectRatio: resolved.aspectRatio } : {}),
    ...(options.quality ? { quality: resolved.quality } : {}),
    ...(options.outputFormat ? { output_format: resolved.outputFormat } : {}),
    ...(options.background ? { background: resolved.background } : {}),
  } : {
    // "gpt-image-2.5-flare" was never a real OpenAI model — every request
    // without an explicit KLIO_IMAGE_MODEL override was failing outright
    // (site owner: tried generating an image, got an error three times in
    // a row). gpt-image-1 is OpenAI's actual current image-generation
    // model and the one whose parameters (size/quality/output_format/
    // background) this file's own resolveImageGenerationOptions already
    // matches.
    model: process.env.KLIO_IMAGE_MODEL?.trim() || "gpt-image-1",
    prompt: prompt.slice(0, 12000),
    n: 1,
    ...(options.size || options.aspectRatio ? { size: resolved.size } : {}),
    ...(options.quality ? { quality: resolved.quality } : {}),
    ...(options.outputFormat ? { output_format: resolved.outputFormat } : {}),
    ...(options.background ? { background: resolved.background } : {}),
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceUrl ? process.env.KLIO_IMAGE_SERVICE_TOKEN : process.env.OPENAI_API_KEY}`,
      "Idempotency-Key": requestId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(imageRequest),
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
  const fileName = resolved.outputFormat === "jpeg" ? "klio.jpeg" : resolved.outputFormat === "webp" ? "klio.webp" : "klio.png";
  const contentType = resolved.outputFormat === "jpeg" ? "image/jpeg" : resolved.outputFormat === "webp" ? "image/webp" : "image/png";
  return uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
}

