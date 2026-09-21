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
  // Was "medium", and only ever sent to the provider when a caller
  // explicitly set options.quality - which nothing in this app actually
  // does (no quality picker anywhere in the UI), so every real request
  // omitted "quality" entirely. For gpt-image-1 that leaves the provider's
  // own default; for gpt-image-2.5 the API guide confirms omitting it
  // defaults to "auto" specifically, not "high" (site owner: "качество
  // как будто низкое"). Defaulting to "high" and always sending it
  // (below) removes that ambiguity instead of hoping "auto" picks well.
  const quality = options.quality && ["low", "medium", "high"].includes(options.quality) ? options.quality : "high";
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

// Shared by createImageFromLogo and createCarouselSlideImage's "logo"
// branch below - was two separately-written copies of the same wording
// until the version that suggested placing the logo "on a sign, package,
// or screen" turned out to steer the model toward a generic laptop/phone
// desk scene (that example list itself, "экране" especially), and to
// treat matching the reference image as the dominant task, dropping
// whatever headline/scene the rest of the prompt actually asked for
// (site owner: with the logo on, back to the same repeated desk mockup,
// and the article's own headline stopped rendering; off, both worked).
// That version's fix ("this is additive, don't remove or simplify
// anything for the logo") overcorrected the other way - telling the
// model not to simplify anything FOR the logo apparently read as
// license to not bother matching it closely either, and it started
// drawing its own generic mark instead of the real reference (site
// owner: "он сам его сочиняет, а не подтягивает"). Leading with an
// explicit, unambiguous "reproduce this exact logo, don't invent one"
// instruction first, before the additive framing, is meant to keep both
// requirements mandatory instead of trading one off against the other.
const LOGO_REFERENCE_INSTRUCTION = "Дополнительно на изображении должен точно повторяться логотип бренда с приложенного референса: те же цвета, форма и текст, максимально близко к оригиналу - не сочиняй новый логотип и не изменяй его. Впиши его в сцену органично, как её часть (например, на вывеске или упаковке), а не отдельным слоем поверх готовой картинки. Это дополнение к сцене, заголовку и тексту из задания выше, а не замена им - сохрани их полностью и не вводи ради логотипа то, чего не просили (ноутбук, телефон, экран устройства).";

export const imageConfigured = () =>
  Boolean(storageConfigured() && (process.env.OPENAI_API_KEY?.trim() ||
    (process.env.KLIO_IMAGE_SERVICE_URL?.trim() && process.env.KLIO_IMAGE_SERVICE_TOKEN?.trim())));

// The actual provider call, split out of createImage below so
// createImageWithLogo can reuse it for the background image instead of
// duplicating the relay/OpenAI request logic - see its own comment.
//
// An optional logo routes this through OpenAI's image-edit endpoint
// instead of generations - the only one that accepts a reference image.
// Deliberately no mask: a mask tells the model to leave everything outside
// it pixel-for-pixel untouched, which is a different feature (exact
// preservation) from what was asked for (site owner: "чтобы он создавал
// максимально приближенный [к логотипу]" - reproduce it closely and weave
// it into the scene, not paste a fixed region into an otherwise-generated
// image).
async function generateImageBytes(
  prompt: string,
  requestId: string,
  options: ImageGenerationOptions = {},
  logo?: { bytes: Uint8Array<ArrayBuffer>; contentType: string },
  model?: string,
) {
  // Browser requests only KLIO. Provider credentials and calls stay on the server;
  // image bytes are copied to our existing object store, never hotlinked to OpenAI.
  // API contract: https://developers.openai.com/api/docs/guides/image-generation
  const serviceUrl = process.env.KLIO_IMAGE_SERVICE_URL?.trim();
  const endpoint = serviceUrl
    ? new URL("/generate", serviceUrl)
    : new URL(logo ? "https://api.openai.com/v1/images/edits" : "https://api.openai.com/v1/images/generations");
  if (endpoint.protocol !== "https:") throw new Error("Сервер изображений должен использовать HTTPS.");
  const resolved = resolveImageGenerationOptions(options);
  const apiKey = serviceUrl ? process.env.KLIO_IMAGE_SERVICE_TOKEN : process.env.OPENAI_API_KEY;
  // "gpt-image-2.5-flare" briefly wasn't a real OpenAI model at all - every
  // request without an explicit KLIO_IMAGE_MODEL override failed outright
  // back when that was the fallback here (site owner: three failures in a
  // row). OpenAI shipped it for real on 2026-09-08; a manual side-by-side
  // test against gpt-image-1 in this same session (see
  // test-image-models.mjs in the scratchpad) confirmed it renders Russian
  // headline text into a generated image far more reliably, so it's now
  // the default instead. Pinned to the dated snapshot rather than the bare
  // rolling alias - OpenAI offers both, and the bare alias can silently
  // start pointing at a different snapshot later; pinning keeps this
  // matching the exact version whose output was actually verified, and a
  // future upgrade becomes a deliberate one-line bump instead of a quiet
  // behavior change. `model` (param) still lets one call ask for a
  // different model than this fallback, without changing every other
  // image call in the app.
  const resolvedModel = model?.trim() || process.env.KLIO_IMAGE_MODEL?.trim() || "gpt-image-2.5-flare-2026-09-08";
  let requestBody: string | FormData;
  let contentTypeHeader: string | undefined;
  if (serviceUrl) {
    const imageRequest = {
      model: resolvedModel,
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
      quality: resolved.quality,
      ...(options.outputFormat ? { output_format: resolved.outputFormat } : {}),
      ...(options.background ? { background: resolved.background } : {}),
      ...(logo ? { image_b64: Buffer.from(logo.bytes).toString("base64"), image_type: logo.contentType } : {}),
    };
    requestBody = JSON.stringify(imageRequest);
    contentTypeHeader = "application/json";
  } else if (logo) {
    const form = new FormData();
    form.append("model", resolvedModel);
    form.append("prompt", prompt.slice(0, 12000));
    form.append("n", "1");
    if (options.size || options.aspectRatio) form.append("size", resolved.size);
    form.append("quality", resolved.quality);
    if (options.outputFormat) form.append("output_format", resolved.outputFormat);
    if (options.background) form.append("background", resolved.background);
    form.append("image", new File([logo.bytes], "reference", { type: logo.contentType }));
    requestBody = form;
  } else {
    requestBody = JSON.stringify({
      model: resolvedModel,
      prompt: prompt.slice(0, 12000),
      n: 1,
      ...(options.size || options.aspectRatio ? { size: resolved.size } : {}),
      quality: resolved.quality,
      ...(options.outputFormat ? { output_format: resolved.outputFormat } : {}),
      ...(options.background ? { background: resolved.background } : {}),
    });
    contentTypeHeader = "application/json";
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": requestId,
      ...(contentTypeHeader ? { "Content-Type": contentTypeHeader } : {}),
    },
    body: requestBody,
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

export async function createImage(prompt: string, email: string, baseUrl: string, requestId: string, options: ImageGenerationOptions = {}, model?: string) {
  const { bytes, contentType } = await generateImageBytes(prompt, requestId, options, undefined, model);
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  return uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
}

// Agreed design (after two rejected attempts - a maskless edit that let
// the model redraw/ignore the logo, then a sharp-composited corner
// overlay that the site owner didn't want at any fidelity): pass the real
// logo file to OpenAI's edit endpoint as a reference, with the prompt
// explicitly asking for a close likeness woven into the scene, not a
// preserved fixed region and not a watermark. This trades exact-pixel
// fidelity for a natural-looking result - the model still redraws the
// logo, just deliberately steered to match it closely instead of treating
// it as a loose stylistic cue.
export async function createImageFromLogo(
  prompt: string,
  logo: { bytes: Uint8Array<ArrayBuffer>; contentType: string },
  email: string,
  baseUrl: string,
  requestId: string,
  options: ImageGenerationOptions = {},
  model?: string,
) {
  const guidedPrompt = `${prompt}\n\n${LOGO_REFERENCE_INSTRUCTION}`;
  const { bytes, contentType } = await generateImageBytes(guidedPrompt, requestId, options, logo, model);
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  return uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
}

// Sibling to createImageFromLogo above, for a carousel's per-slide
// reference image, which serves one of two different purposes depending
// on `reference.kind` - the wording has to match which one it actually is:
// - "logo": slide 1 when the brand logo is requested - same "weave it in
//   naturally, reproduce it closely" framing as createImageFromLogo.
// - "previous-slide": every slide after that references the one before it
//   for style/composition consistency (the reference-image chaining
//   OpenAI's own docs describe for gpt-image-2.5 multi-image consistency -
//   confirmed via the API guide, up to 16 reference images, no dedicated
//   "generate a consistent set" endpoint exists), not to match a fixed
//   logo. Slide 1's own bytes already carry the logo forward into that
//   chain when one was used, but the wording below also reinforces it via
//   text for slides 2+ (see carousel.ts's own prompt for that reminder).
export async function createCarouselSlideImage(
  prompt: string,
  reference: { bytes: Uint8Array<ArrayBuffer>; contentType: string; kind: "logo" | "previous-slide" } | undefined,
  email: string,
  baseUrl: string,
  requestId: string,
  options: ImageGenerationOptions,
  model: string,
) {
  const guidedPrompt = !reference
    ? prompt
    : reference.kind === "logo"
      ? `${prompt}\n\n${LOGO_REFERENCE_INSTRUCTION}`
      : `${prompt}\n\nЭто один слайд карусели из серии. Сохрани ту же визуальную стилистику, палитру, шрифт и композицию, что и на приложенном референсном изображении - слайды должны выглядеть частью одного набора, но с текстом именно этого слайда, не референсного.`;
  const { bytes, contentType } = await generateImageBytes(guidedPrompt, requestId, options, reference, model);
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  const url = await uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
  // Bytes returned alongside the URL (unlike createImage/createImageFromLogo)
  // so the caller can pass THIS slide's own bytes as the reference for the
  // next one, without an extra round-trip fetch of the just-uploaded file.
  return { url, bytes, contentType };
}

