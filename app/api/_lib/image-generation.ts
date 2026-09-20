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

// The actual provider call, split out of createImage below so
// createImageWithLogo can reuse it for the background image instead of
// duplicating the relay/OpenAI request logic - see its own comment.
async function generateImageBytes(prompt: string, requestId: string, options: ImageGenerationOptions = {}) {
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
  // Detected from the actual bytes, not assumed from resolved.outputFormat
  // (site owner: generation "didn't work at all for jpg, only png worked").
  // The relay is a separate deployment this repo doesn't control - it
  // silently ignores every option except the bare prompt (confirmed via
  // request/response logging: size stays square regardless of aspect
  // ratio, format stays png regardless of output_format - site owner:
  // "какое бы соотношение ни выбрал, всё равно 1:1", "какой бы формат ни
  // выбрал, всё равно png"). Trusting the request for either would mean
  // this file's declared type mismatched what actually came back.
  //
  // Deliberately NOT cropping or re-encoding to force a match here anymore:
  // cropping can cut off in-image content (text, a logo, anything near the
  // edge) that the model placed assuming the full square canvas - site
  // owner rejected that trade explicitly ("Обрезать ничего не надо! Там же
  // в картинке может быть текст и он уйдет тогда за края или обрежется!").
  // The real fix has to be the relay honoring size/output_format, or a
  // properly-configured direct OpenAI call - see the API research notes
  // this repo's PR/commit message links, not a client-side workaround.
  const detectedType = imageContentType(bytes) || "image/png";
  return { bytes, contentType: detectedType, resolved };
}

export async function createImage(prompt: string, email: string, baseUrl: string, requestId: string, options: ImageGenerationOptions = {}) {
  const { bytes, contentType } = await generateImageBytes(prompt, requestId, options);
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  return uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
}

// Placeholder pending a real design for logo integration: an earlier
// version called OpenAI's image-edit endpoint without a mask (the model
// treated the logo as a loose style reference and redrew/ignored it), then
// a second version pasted the uploaded logo as a fixed bottom-right
// overlay via sharp - both rejected by the site owner. The overlay wasn't
// rejected for reliability, it was rejected on the merits: the ask is for
// the logo to read as part of the generated scene (e.g. printed on an
// object in it), not a corner watermark on top of it. Until that's
// designed and agreed, this generates a normal background and does not
// touch the logo at all, rather than shipping either rejected approach
// again.
export async function createImageFromLogo(
  prompt: string,
  _logo: { bytes: Uint8Array<ArrayBuffer>; contentType: string },
  email: string,
  baseUrl: string,
  requestId: string,
  options: ImageGenerationOptions = {},
) {
  return createImage(prompt, email, baseUrl, requestId, options);
}

