import { storageConfigured, uploadPublicationImage } from "./storage";
import { imageContentType } from "./image-type";

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
    // aspectRatio deliberately not sent (site owner confirmed: "1:1"
    // generates fine, every non-square ratio still fails even after
    // resolved.size above was fixed to a real OpenAI size). The relay
    // service is a separate deployment this repo doesn't control - if its
    // own code recomputes a size from aspectRatio instead of trusting the
    // size already sent, that recomputation can't be fixed here. Not
    // sending aspectRatio at all removes that option: the relay only ever
    // sees the already-correct, already-resolved size.
    ...(options.size || options.aspectRatio ? { size: resolved.size } : {}),
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
  // Temporary: site owner reports every aspect ratio produces a square
  // image regardless of selection, after two prior guesses about how the
  // relay (a separate deployment this repo doesn't control) handles
  // size/aspectRatio both turned out wrong. Logging exactly what we send
  // is something checkable in Timeweb's own application logs (this
  // request originates from our app, not the relay) - confirms whether
  // our own payload is correct before guessing a third time. Remove once
  // the actual cause is confirmed.
  if (serviceUrl) console.log("Image request to relay", JSON.stringify(imageRequest));
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
  if (!response.ok) {
    // Temporary, same reasoning as the request/response-size logging above -
    // the route above this only ever shows the person a generic "не
    // удалось создать" regardless of cause (it doesn't special-case a
    // plain Error), so an instant failure with no server-side visibility
    // into OpenAI's own rejection reason (auth, quota, unverified org,
    // bad request) is otherwise a dead end. Body may be JSON or plain
    // text depending on what actually rejected the request.
    const bodyText = await response.text().catch(() => "");
    console.error(`Image provider rejected the request: ${response.status} ${bodyText.slice(0, 2000)}`);
    throw new Error(
      "Сервис изображений не выполнил запрос. Попробуйте другое описание или загрузите свою картинку.",
    );
  }
  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded || encoded.length > 12_000_000)
    throw new Error("Сервис изображений вернул некорректный файл.");
  const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
  // Temporary, same reasoning as the request log above - confirms the
  // actual returned image's real pixel dimensions regardless of what any
  // log or field name claims, since a mismatch there is exactly what
  // "every ratio produces a square" would look like from the bytes
  // themselves. PNG only (the current default/most-tested format); logs
  // "unknown" for jpeg/webp rather than a fuller multi-format parser,
  // since this is throwaway diagnostic code, not a permanent utility.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    console.log(`Image response actual size: ${width}x${height} (requested ${resolved.size})`);
  } else {
    console.log(`Image response actual size: unknown format, ${bytes.length} bytes (requested ${resolved.size})`);
  }
  // Detected from the actual bytes, not assumed from resolved.outputFormat
  // (site owner: generation "didn't work at all for jpg, only png worked").
  // The relay is a separate deployment this repo doesn't control (see the
  // aspectRatio comment above) - if it silently returns png regardless of
  // the requested output_format, trusting the request meant this file's
  // declared type mismatched what uploadPublicationImage's own signature
  // check found in the bytes, and every non-png result was rejected
  // outright. Uploading under whatever format the bytes actually are
  // means a substituted png still succeeds, just as png, instead of
  // failing.
  const detectedType = imageContentType(bytes);
  const contentType = detectedType ||
    (resolved.outputFormat === "jpeg" ? "image/jpeg" : resolved.outputFormat === "webp" ? "image/webp" : "image/png");
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  return uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
}

// Attaches the brand's real logo file via OpenAI's image-edit endpoint,
// instead of the model inventing its own logo from the prompt text alone
// (site owner: "чтобы он каждый раз сам не придумывал логотип при
// генерации изображения"). Always calls OpenAI directly, never through
// the relay (KLIO_IMAGE_SERVICE_URL) - the relay's own /generate contract
// is JSON-only (see createImage above) and has no way to carry a file
// upload; only this server, with its own OPENAI_API_KEY, can make a
// multipart request to /v1/images/edits.
export async function createImageFromLogo(
  prompt: string,
  logo: { bytes: Uint8Array<ArrayBuffer>; contentType: string },
  email: string,
  baseUrl: string,
  requestId: string,
  options: ImageGenerationOptions = {},
) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    throw new Error(
      "Использование логотипа требует прямого подключения к OpenAI (переменная OPENAI_API_KEY на сервере) — сервис-релей эту функцию не поддерживает.",
    );
  const resolved = resolveImageGenerationOptions(options);
  const extension = logo.contentType === "image/png" ? "png" : logo.contentType === "image/webp" ? "webp" : logo.contentType === "image/gif" ? "gif" : "jpg";
  const form = new FormData();
  form.set("model", process.env.KLIO_IMAGE_MODEL?.trim() || "gpt-image-1");
  form.set(
    "prompt",
    `${prompt}\n\nВ приложенном файле — логотип бренда. Сохрани его без изменений (форму, цвета, надписи) и естественно размести на итоговом изображении, не перерисовывая и не искажая сам логотип.`.slice(0, 32000),
  );
  form.set("size", resolved.size);
  if (options.quality) form.set("quality", resolved.quality);
  if (options.background) form.set("background", resolved.background);
  if (options.outputFormat) form.set("output_format", resolved.outputFormat);
  form.set("image", new File([logo.bytes], `logo.${extension}`, { type: logo.contentType }));
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": requestId,
    },
    body: form,
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(`Image provider (edit endpoint) rejected the request: ${response.status} ${bodyText.slice(0, 2000)}`);
    throw new Error(
      "Сервис изображений не выполнил запрос с логотипом. Попробуйте другое описание или отключите использование логотипа.",
    );
  }
  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded || encoded.length > 12_000_000)
    throw new Error("Сервис изображений вернул некорректный файл.");
  const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
  const detectedType = imageContentType(bytes);
  const contentType = detectedType ||
    (resolved.outputFormat === "jpeg" ? "image/jpeg" : resolved.outputFormat === "webp" ? "image/webp" : "image/png");
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  return uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
}

