import { storageConfigured, uploadPublicationImage } from "./storage";
import { imageContentType } from "./image-type";
import { ImageInputError, ImageRelayUpgradeRequiredError } from "./image-generation-errors";
import type { CarouselSlideIndicatorMode, CarouselTemplateId } from "../../carousel-templates";
import { carouselSlideIndicatorInstruction, carouselTemplateInstruction } from "../../carousel-templates";
import { normalizeImageUsage, type ImageProviderUsage } from "./image-cost";

export type ImageAspectRatio = "1:1" | "3:4" | "4:3" | "4:5" | "16:9" | "9:16";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageQuality = "low" | "medium" | "high" | "xhigh" | "max";
export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type ImageInput = { bytes: Uint8Array<ArrayBuffer>; contentType: string };
export type ImageReferenceRole = "object" | "style";
export type LocalImageEditOperation = "auto-correction" | "denoise" | "sharpen" | "portrait-enhance";
type ImagePartialHandler = (dataUrl: string) => void;
type ImageUsageHandler = (usage: ImageProviderUsage) => void;
export type ImageGenerationOptions = {
  size?: string;
  aspectRatio?: ImageAspectRatio;
  quality?: ImageQuality;
  outputFormat?: ImageOutputFormat;
  background?: "auto" | "transparent" | "opaque";
  // "overlay" is a legacy client value; it now means an adapted corner mark.
  logoPlacement?: "scene" | "corner" | "both" | "overlay";
  logoPosition?: LogoPosition;
  // Preserve the uploaded logo asset by compositing it after model generation.
  // A model reference alone cannot guarantee faithful reproduction.
  exactLogoOverlay?: boolean;
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
  // Marketplace cards use the common 3:4 canvas (Ozon 1200x1600 and WB
  // 900x1200). The provider still receives its supported portrait canvas;
  // the final file is fitted to the requested target size below.
  "3:4": "1024x1365",
  "4:3": "1536x1024",
  "16:9": "1536x1024",
  "4:5": "1024x1536",
  "9:16": "1024x1536",
};
const PROVIDER_IMAGE_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536", "auto"]);

function providerSizeForTarget(size: string) {
  if (PROVIDER_IMAGE_SIZES.has(size)) return size;
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return "1024x1024";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

async function fitImageToRequestedCanvas(
  bytes: Uint8Array<ArrayBuffer>,
  targetSize: string,
  outputFormat: ImageOutputFormat,
  background: "auto" | "transparent" | "opaque",
) {
  if (!/^\d+x\d+$/.test(targetSize) || PROVIDER_IMAGE_SIZES.has(targetSize)) return bytes;
  const match = /^(\d+)x(\d+)$/.exec(targetSize);
  if (!match) return bytes;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const sharp = (await import("sharp")).default;
  // Contain keeps the whole generated composition and adds only a small
  // canvas margin when the provider's nearest supported canvas has another
  // ratio. This is deliberate: a marketplace card must be 3:4 without
  // cutting off a face, logo or text near the edge.
  const canvasBackground = background === "transparent"
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : { r: 255, g: 255, b: 255, alpha: 1 };
  const pipeline = sharp(bytes).rotate().resize(width, height, { fit: "contain", background: canvasBackground });
  if (outputFormat === "jpeg") return Uint8Array.from(await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer());
  if (outputFormat === "webp") return Uint8Array.from(await pipeline.webp({ quality: 92, alphaQuality: 100 }).toBuffer());
  return Uint8Array.from(await pipeline.png().toBuffer());
}

// Narrows raw request-body values (typeof-checked strings, but not yet
// known to be one of the accepted union members) into ImageGenerationOptions.
// An unrecognized value silently becomes undefined here rather than a
// validation error - resolveImageGenerationOptions below already falls
// back to sane defaults for anything missing, so a typo/garbage value from
// the client just gets the default treatment instead of a 400.
export function parseImageGenerationOptions(input: Record<string, unknown>): ImageGenerationOptions {
  const aspectRatio = typeof input.aspectRatio === "string" && (["1:1", "3:4", "4:3", "4:5", "16:9", "9:16"] as const).includes(input.aspectRatio as ImageAspectRatio)
    ? (input.aspectRatio as ImageAspectRatio) : undefined;
  const quality = typeof input.quality === "string" && (["low", "medium", "high", "xhigh", "max"] as const).includes(input.quality as ImageQuality)
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
    logoPlacement: input.logoPlacement === "both" ? "both" : input.logoPlacement === "corner" || input.logoPlacement === "overlay" ? "corner" : "scene",
    logoPosition: input.logoPosition === "top-left" || input.logoPosition === "top-right" || input.logoPosition === "bottom-left" ? input.logoPosition : "bottom-right",
  };
}

export function resolveImageGenerationOptions(options: ImageGenerationOptions = {}) {
  const ratio = options.aspectRatio && IMAGE_SIZE_BY_RATIO[options.aspectRatio] ? options.aspectRatio : "4:3";
  const size = options.size && (options.size === "auto" || /^\d+x\d+$/.test(options.size)) ? options.size : IMAGE_SIZE_BY_RATIO[ratio];
  const providerSize = providerSizeForTarget(size);
  // Was "medium", and only ever sent to the provider when a caller
  // explicitly set options.quality - which nothing in this app actually
  // does (no quality picker anywhere in the UI), so every real request
  // omitted "quality" entirely. For gpt-image-1 that leaves the provider's
  // own default; for gpt-image-2.5 the API guide confirms omitting it
  // defaults to "auto" specifically, not "high" (site owner: "качество
  // как будто низкое"). Defaulting to "high" and always sending it
  // (below) removes that ambiguity instead of hoping "auto" picks well.
  const quality = options.quality && ["low", "medium", "high", "xhigh", "max"].includes(options.quality) ? options.quality : "high";
  const outputFormat = options.outputFormat && ["png", "jpeg", "webp"].includes(options.outputFormat) ? options.outputFormat : "png";
  const background = options.background && ["auto", "transparent", "opaque"].includes(options.background) ? options.background : "auto";

  return {
    aspectRatio: ratio,
    size,
    providerSize,
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
const LOGO_REFERENCE_INSTRUCTION = "Дополнительно на изображении должен точно повторяться логотип бренда с приложенного референса: те же цвета, форма и текст, максимально близко к оригиналу - не сочиняй новый логотип и не изменяй его. Впиши его в сцену органично, как её часть (например, на вывеске или упаковке), а не отдельным слоем поверх готовой картинки. Это дополнение к сцене и только тем надписям, которые разрешены выбранными параметрами, а не замена им. Не переноси текст статьи на картинку, если выбран режим без текста. Надпись внутри самого логотипа сохрани. Не вводи ради логотипа то, чего не просили (ноутбук, телефон, экран устройства).";
const CAROUSEL_LOGO_REFERENCE_INSTRUCTION = "Приложенный референс — только логотип бренда: точно сохрани его форму, цвета и внутреннюю надпись. Не копируй из референса фон или композицию. Встрой логотип в сцену органично, не перекрывая заголовок и основной текст.";

function providerErrorSummary(bodyText: string) {
  try {
    const payload = JSON.parse(bodyText) as { error?: { code?: unknown; type?: unknown; message?: unknown } | string };
    const issue = typeof payload.error === "object" && payload.error ? payload.error : null;
    return {
      code: typeof issue?.code === "string" ? issue.code.slice(0, 120) : undefined,
      type: typeof issue?.type === "string" ? issue.type.slice(0, 120) : undefined,
      message: typeof issue?.message === "string" ? issue.message.slice(0, 400) : undefined,
    };
  } catch {
    return { message: bodyText.slice(0, 400) || undefined };
  }
}

export const imageConfigured = () =>
  Boolean(storageConfigured() && (process.env.OPENAI_API_KEY?.trim() ||
    (process.env.KLIO_IMAGE_SERVICE_URL?.trim() && process.env.KLIO_IMAGE_SERVICE_TOKEN?.trim())));

function cornerLogoInstruction(position: LogoPosition = "bottom-right") {
  const corner = { "top-left": "слева вверху", "top-right": "справа вверху", "bottom-left": "слева внизу", "bottom-right": "справа внизу" }[position];
  return `Адаптируй настоящий логотип с приложенного референса и размести его ${corner} как небольшой графический знак. Максимально точно воспроизведи форму, пропорции, цвета и собственную надпись логотипа; не придумывай другой знак или бренд. Адаптация касается масштаба и окружения, а не редизайна логотипа.
Файл логотипа может быть JPEG, PNG или WEBP с непрозрачным фоном. Отдели сам знак и его надпись от внешнего фона файла: не копируй квадратную или прямоугольную подложку, поля и лишний фон референса. Сохрани элементы, которые действительно являются частью самого знака. Прозрачность референса относится только к логотипу, а не к итоговой картинке.
Компонуй логотип и разрешённый заголовок одновременно. Не перекрывай логотипом текст, лица и значимые объекты; не накладывай текст на логотип. Сохрани выбранную надпись полностью и читаемо, оставь между ней и знаком свободное расстояние. Уменьши знак или немного сдвинь его внутри выбранного угла, если там тесно. Ориентир: ширина знака до 12–15% кадра, отступ от краёв 3–5%; приоритет — отсутствие пересечений и читаемость. В новой сцене заранее учти их раздельное размещение. При редактировании сохраняй существующие надписи и детали исходника, которых запрос не касается.
Не стирай и не размывай картинку ради места под логотип. Не добавляй пустой прямоугольник, рамку, виньетку, прозрачные края или подложку. Сцена должна продолжаться по всей площади, включая углы; итоговое изображение непрозрачное. Не добавляй ради логотипа новые предметы. Режим «Без текста» запрещает новые заголовки, но собственная надпись настоящего логотипа сохраняется.`;
}

function logoPlacementInstruction(placement: ImageGenerationOptions["logoPlacement"], position?: LogoPosition) {
  if (placement === "corner" || placement === "overlay") return cornerLogoInstruction(position);
  if (placement !== "both") return LOGO_REFERENCE_INSTRUCTION;
  const corner = { "top-left": "слева вверху", "top-right": "справа вверху", "bottom-left": "слева внизу", "bottom-right": "справа внизу" }[position || "bottom-right"];
  return `${LOGO_REFERENCE_INSTRUCTION}\n\n${cornerLogoInstruction(position)}\n\nЭто два размещения одного приложенного логотипа: один знак встроен в сцену, второй стоит отдельно ${corner}. Не добавляй другие логотипы; разнеси оба знака так, чтобы они не перекрывали текст, лица и важные детали.`;
}

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
  logo?: ImageInput | ImageInput[],
  model?: string,
  mask?: ImageInput,
  onPartial?: ImagePartialHandler,
  onUsage?: ImageUsageHandler,
) {
  // Browser requests only KLIO. Provider credentials and calls stay on the server;
  // image bytes are copied to our existing object store, never hotlinked to OpenAI.
  // API contract: https://developers.openai.com/api/docs/guides/image-generation
  const serviceUrl = process.env.KLIO_IMAGE_SERVICE_URL?.trim();
  const images = Array.isArray(logo) ? logo : logo ? [logo] : [];
  if (images.length > 2) throw new Error("Можно использовать один исходник и один логотип.");
  const endpoint = serviceUrl
    ? new URL("/generate", serviceUrl)
    : new URL(logo ? "https://api.openai.com/v1/images/edits" : "https://api.openai.com/v1/images/generations");
  if (endpoint.protocol !== "https:") throw new Error("Сервер изображений должен использовать HTTPS.");
  const resolved = resolveImageGenerationOptions(options);
  let relayStreaming = false;
  let relayMaskEditing = false;
  const apiKey = serviceUrl ? process.env.KLIO_IMAGE_SERVICE_TOKEN : process.env.OPENAI_API_KEY;
  // Use Sunburst as the shared default for generation and editing because
  // OpenAI describes it as the higher-quality option. Flare remains
  // available as an explicit faster alternative. Undated aliases let
  // provider improvements roll forward without a code change; `model` and
  // environment variables still allow an explicit override.
  const resolvedModel = model?.trim() || (mask
    ? process.env.KLIO_IMAGE_EDIT_MODEL?.trim() || "gpt-image-2.5-sunburst"
    : process.env.KLIO_IMAGE_MODEL?.trim() || "gpt-image-2.5-sunburst");
  let requestBody: string | FormData;
  let contentTypeHeader: string | undefined;
  if (serviceUrl) {
    if (images.length > 1 || mask || onPartial) {
      // An older relay silently ignores unknown fields. Fail before a paid
      // request rather than generate a different scene without the source.
      const health = await fetch(new URL("/health", serviceUrl), { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!health.ok) throw new Error("Не удалось проверить доступность сервера изображений.");
      const capabilities = await health.json().catch(() => null);
      relayStreaming = capabilities?.streaming === true;
      relayMaskEditing = capabilities?.editMasks === true;
      if (images.length > 1 && (!Number.isInteger(capabilities?.maxImageInputs) || capabilities.maxImageInputs < images.length))
        throw new ImageRelayUpgradeRequiredError();
      if (mask && !relayMaskEditing) throw new ImageRelayUpgradeRequiredError("Для редактирования кистью требуется обновить сервер изображений. Обычная доработка доступна.");
    }
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
      ...(options.size || options.aspectRatio ? { size: resolved.providerSize } : {}),
      quality: resolved.quality,
      ...(onPartial && (!serviceUrl || relayStreaming) ? { stream: true, partial_images: 2 } : {}),
      ...(mask ? { mask_b64: Buffer.from(mask.bytes).toString("base64"), mask_type: mask.contentType } : {}),
      ...(options.outputFormat ? { output_format: resolved.outputFormat } : {}),
      ...(options.background ? { background: resolved.background } : {}),
      ...(images.length > 1 ? { images: images.map((item) => ({ image_b64: Buffer.from(item.bytes).toString("base64"), image_type: item.contentType })) }
        : images[0] ? { image_b64: Buffer.from(images[0].bytes).toString("base64"), image_type: images[0].contentType } : {}),
    };
    requestBody = JSON.stringify(imageRequest);
    contentTypeHeader = "application/json";
  } else if (logo) {
    const form = new FormData();
    form.append("model", resolvedModel);
    form.append("prompt", prompt.slice(0, 12000));
    form.append("n", "1");
    if (options.size || options.aspectRatio) form.append("size", resolved.providerSize);
    form.append("quality", resolved.quality);
    if (onPartial && (!serviceUrl || relayStreaming)) { form.append("stream", "true"); form.append("partial_images", "2"); }
    if (options.outputFormat) form.append("output_format", resolved.outputFormat);
    if (options.background) form.append("background", resolved.background);
    images.forEach((item, index) => form.append(images.length > 1 ? "image[]" : "image", new File([item.bytes], `reference-${index}`, { type: item.contentType })));
    if (mask) form.append("mask", new File([mask.bytes], "mask.png", { type: mask.contentType }));
    requestBody = form;
  } else {
    requestBody = JSON.stringify({
      model: resolvedModel,
      prompt: prompt.slice(0, 12000),
      n: 1,
      ...(options.size || options.aspectRatio ? { size: resolved.providerSize } : {}),
      quality: resolved.quality,
      ...(onPartial && (!serviceUrl || relayStreaming) ? { stream: true, partial_images: 2 } : {}),
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
    console.error("Image provider rejected the request", { requestId, status: response.status, ...providerErrorSummary(bodyText) });
    throw new Error(
      "Сервис изображений не выполнил запрос. Попробуйте другое описание или загрузите свою картинку.",
    );
  }
  const responseData = onPartial && (!serviceUrl || relayStreaming)
    ? await readPartialImages(response, onPartial)
    : (() => undefined)();
  const directData = responseData ? null : await response.json() as {
    data?: Array<{ b64_json?: string }>;
    usage?: unknown;
  };
  const encoded = responseData?.encoded ?? directData?.data?.[0]?.b64_json;
  onUsage?.(normalizeImageUsage(responseData?.usage ?? directData?.usage, {
    model: resolvedModel,
    promptCharacters: prompt.length,
    referenceImageCount: images.length,
    size: resolved.providerSize,
    quality: resolved.quality,
    partialImages: onPartial && (!serviceUrl || relayStreaming) ? 2 : 0,
  }));
  if (!encoded || encoded.length > 12_000_000)
    throw new Error("Сервис изображений вернул некорректный файл.");
  const providerBytes = new Uint8Array(Buffer.from(encoded, "base64"));
  const bytes = await fitImageToRequestedCanvas(providerBytes, resolved.size, resolved.outputFormat, resolved.background);
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
  // Non-canonical requested canvases are fitted above without cropping the composition.
  const detectedType = imageContentType(bytes) || "image/png";
  return { bytes, contentType: detectedType, resolved };
}

async function readPartialImages(response: Response, onPartial: ImagePartialHandler) {
  if (!response.body) throw new Error("Поток генерации изображений не был открыт.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalImage = "";
  let usage: unknown;
  const handleData = (line: string) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    let event: { type?: string; b64_json?: string; output_format?: string; usage?: unknown };
    try { event = JSON.parse(raw); } catch { return; }
    if (event.usage) usage = event.usage;
    if (!event.b64_json) return;
    if (event.type === "partial" || event.type?.includes("partial_image")) {
      const type = event.output_format === "jpeg" ? "image/jpeg" : event.output_format === "webp" ? "image/webp" : "image/png";
      onPartial(`data:${type};base64,${event.b64_json}`);
    } else if (event.type === "complete" || event.type?.endsWith(".completed")) finalImage = event.b64_json;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(handleData);
      if (done) break;
    }
  } finally { reader.releaseLock(); }
  if (buffer) handleData(buffer);
  if (!finalImage || finalImage.length > 12_000_000) throw new Error("Поток завершился без итогового изображения.");
  return { encoded: finalImage, usage };
}

export async function createImage(prompt: string, email: string, baseUrl: string, requestId: string, options: ImageGenerationOptions = {}, model?: string, onPartial?: ImagePartialHandler, onUsage?: ImageUsageHandler) {
  const { bytes, contentType } = await generateImageBytes(prompt, requestId, options, undefined, model, undefined, onPartial, onUsage);
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  return uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
}

// Both placements use the real logo as a model reference. Rendering the corner
// mark together with the scene lets the model plan around captions and omit
// the file's rectangular backdrop instead of pasting it over finished artwork.
export async function createImageFromLogo(
  prompt: string,
  logo: { bytes: Uint8Array<ArrayBuffer>; contentType: string },
  email: string,
  baseUrl: string,
  requestId: string,
  options: ImageGenerationOptions = {},
  model?: string,
  onPartial?: ImagePartialHandler,
  onUsage?: ImageUsageHandler,
) {
  const corner = options.logoPlacement === "corner" || options.logoPlacement === "both" || options.logoPlacement === "overlay";
  const exactOverlay = options.exactLogoOverlay === true;
  const guidedPrompt = exactOverlay
    ? `${prompt}\n\nНе рисуй логотипы, названия бренда, фирменные знаки или водяные знаки. Оставь свободным угол ${logoPositionLabel(options.logoPosition)}: после генерации туда будет помещён исходный файл логотипа без перерисовки.`
    : `${prompt}\n\n${logoPlacementInstruction(options.logoPlacement, options.logoPosition)}`;
  const generationOptions = corner || exactOverlay ? { ...options, background: "opaque" as const } : options;
  const generated = await generateImageBytes(guidedPrompt, requestId, generationOptions, exactOverlay ? undefined : logo, model, undefined, onPartial, onUsage);
  const { bytes, contentType } = exactOverlay ? await overlayOriginalLogo(generated.bytes, logo, options) : generated;
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  return uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
}

// The first image is the actual scene or primary reference. A second image
// can be a user-provided style/object reference or the real brand logo; the
// first input always remains the source for edits.
export async function createImageFromSource(
  prompt: string, source: ImageInput, purpose: "edit" | "reference", logo: ImageInput | undefined,
  email: string, baseUrl: string, requestId: string, options: ImageGenerationOptions = {}, mask?: ImageInput, onPartial?: ImagePartialHandler, onUsage?: ImageUsageHandler, references: ImageInput[] = [], referenceRoles: ImageReferenceRole[] = [],
) {
  const maxInputBytes = 8 * 1024 * 1024;
  if (references.length > 1) throw new ImageInputError("Можно добавить только один дополнительный референс к исходному изображению.");
  for (const image of [source, ...references, ...(logo ? [logo] : [])]) {
    const detected = imageContentType(image.bytes);
    if (!detected || !["image/png", "image/jpeg", "image/webp"].includes(detected))
      throw new ImageInputError("Для доработки загрузите изображение в формате PNG, JPEG или WEBP.");
    image.contentType = detected;
    // A generated PNG can be larger than the upload limit even though it is
    // a valid saved material. Optimize oversized unmasked inputs before they
    // reach the provider or the relay's 8 MiB per-image limit. Masked source
    // images are normalized together with their mask below to keep dimensions
    // identical.
    if (image.bytes.byteLength > maxInputBytes && !(mask && image === source)) {
      const sharp = (await import("sharp")).default;
      const metadata = await sharp(image.bytes).metadata();
      if (!metadata.width || !metadata.height)
        throw new ImageInputError("Не удалось прочитать исходное изображение. Загрузите PNG, JPEG или WEBP.");
      let scale = Math.min(1, Math.sqrt(8_294_400 / (metadata.width * metadata.height)));
      let optimized: Buffer | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const width = Math.max(1, Math.floor(metadata.width * scale));
        const height = Math.max(1, Math.floor(metadata.height * scale));
        const pipeline = sharp(image.bytes).rotate().resize(width, height, { fit: "inside", withoutEnlargement: true, kernel: "lanczos3" });
        optimized = metadata.hasAlpha
          ? await pipeline.webp({ quality: 92, effort: 4, alphaQuality: 100 }).toBuffer()
          : await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
        if (optimized.byteLength <= maxInputBytes) break;
        scale *= Math.min(0.85, Math.sqrt(maxInputBytes / optimized.byteLength) * 0.92);
      }
      if (!optimized || optimized.byteLength > maxInputBytes)
        throw new ImageInputError("Исходное изображение слишком большое. Уменьшите его размер и загрузите снова.");
      image.bytes = Uint8Array.from(optimized);
      image.contentType = metadata.hasAlpha ? "image/webp" : "image/jpeg";
    }
  }
  if (mask && (purpose !== "edit" || logo)) throw new ImageInputError("Кисть доступна только при редактировании изображения без логотипа.");
  if (mask && (mask.contentType !== "image/png" || mask.bytes.byteLength > maxInputBytes)) throw new ImageInputError("Выделение слишком большое или повреждено. Сбросьте кисть и отметьте область снова.");
  if (mask) {
    const sharp = (await import("sharp")).default;
    const [sourceMetadata, maskMetadata] = await Promise.all([
      sharp(source.bytes).metadata(),
      sharp(mask.bytes).metadata(),
    ]);
    if (!sourceMetadata.width || !sourceMetadata.height || maskMetadata.format !== "png" || !maskMetadata.hasAlpha)
      throw new ImageInputError("Не удалось прочитать прозрачное выделение. Сбросьте кисть и отметьте область снова.");
    const rotated = (sourceMetadata.orientation || 1) >= 5 && (sourceMetadata.orientation || 1) <= 8;
    const sourceWidth = rotated ? sourceMetadata.height : sourceMetadata.width;
    const sourceHeight = rotated ? sourceMetadata.width : sourceMetadata.height;
    if (maskMetadata.width !== sourceWidth || maskMetadata.height !== sourceHeight)
      throw new ImageInputError("Размер выделения не совпадает с изображением. Сбросьте кисть и отметьте область снова.");

    const minPixels = 655_360;
    const maxPixels = 8_294_400;
    const originalPixels = sourceWidth * sourceHeight;
    const scale = originalPixels < minPixels
      ? Math.sqrt(minPixels / originalPixels)
      : originalPixels > maxPixels
        ? Math.sqrt(maxPixels / originalPixels)
        : 1;
    let width = Math.max(1, scale < 1 ? Math.floor(sourceWidth * scale) : Math.ceil(sourceWidth * scale));
    let height = Math.max(1, scale < 1 ? Math.floor(sourceHeight * scale) : Math.ceil(sourceHeight * scale));
    while (originalPixels < minPixels && width * height < minPixels) {
      if (width / sourceWidth <= height / sourceHeight) width += 1;
      else height += 1;
    }
    let sourcePng: Buffer;
    let maskPng: Buffer;
    while (true) {
      sourcePng = await sharp(source.bytes)
        .rotate()
        .resize(width, height, { fit: "fill", kernel: "lanczos3" })
        .png({ compressionLevel: 9 })
        .toBuffer();
      maskPng = await sharp(mask.bytes)
        .resize(width, height, { fit: "fill", kernel: "nearest" })
        .png({ compressionLevel: 9 })
        .toBuffer();
      if (sourcePng.byteLength <= maxInputBytes && maskPng.byteLength <= maxInputBytes) break;
      const nextScale = Math.sqrt(maxInputBytes / Math.max(sourcePng.byteLength, maskPng.byteLength)) * 0.9;
      const nextWidth = Math.max(1, Math.floor(width * nextScale));
      const nextHeight = Math.max(1, Math.floor(height * nextScale));
      if (nextWidth * nextHeight < minPixels || (nextWidth === width && nextHeight === height))
        throw new ImageInputError("Изображение слишком большое для кисти. Загрузите файл меньшего размера.");
      width = nextWidth;
      height = nextHeight;
    }
    if (width * height < minPixels || width * height > maxPixels)
      throw new ImageInputError("Размер изображения не поддерживается для правки кистью.");
    source.bytes = Uint8Array.from(sourcePng);
    source.contentType = "image/png";
    mask.bytes = Uint8Array.from(maskPng);
    mask.contentType = "image/png";
  }
  const instruction = purpose === "edit"
    ? "Первое изображение — исходник для редактирования. Измени именно его по запросу пользователя. Сохрани композицию, людей, предметы, ракурс, освещение и все детали, которых правка не касается. Сохрани изображение по всей площади, включая края и углы. Не стирай участки исходника и не освобождай место под логотип. Не создавай новую сцену по старому описанию."
    : "Первое изображение — визуальный референс. Учитывай его реальные детали, композицию и стиль при выполнении запроса пользователя.";
  const maskInstruction = mask
    ? "Голубая кисть отмечает единственную область, которую разрешено менять. Выполни запрос внутри выделения; не перемещай новые объекты в другие части кадра. За пределами выделения оставь исходные пиксели без изменений."
    : "";
  const corner = Boolean(logo) && (options.logoPlacement === "corner" || options.logoPlacement === "both" || options.logoPlacement === "overlay");
  const exactOverlay = Boolean(logo && options.exactLogoOverlay === true);
  const logoInstruction = exactOverlay
    ? `Не рисуй логотипы, названия бренда, фирменные знаки или водяные знаки. Оставь свободным угол ${logoPositionLabel(options.logoPosition)}: после генерации туда будет помещён исходный файл логотипа без перерисовки.`
    : logo
    ? "Второе изображение — настоящий логотип бренда. Используй именно этот знак и его надпись; не выдумывай другой бренд. Размести его на первом изображении в соответствии с запросом. Прозрачность вокруг знака относится только к файлу логотипа: не переноси её на фотографию и не удаляй под ним или вокруг него исходное изображение."
    : "Логотип бренда не приложен. Не выдумывай фирменные знаки.";
  // With an RGBA logo, automatic background selection can make the entire
  // edited photograph translucent. Request an opaque edit explicitly; PNG
  // describes the file format and does not itself require transparency.
  const editOptions = purpose === "edit"
    ? { size: "auto", outputFormat: options.outputFormat, quality: options.quality, background: options.background ?? "opaque" as const }
    : corner ? { ...options, background: "opaque" as const } : options;
  if (corner) editOptions.background = "opaque";
  const backgroundInstruction = editOptions.background === "opaque"
    ? "Результат — цельное непрозрачное изображение. Не добавляй прозрачные участки, полупрозрачные края, виньетку, рамку или подложку под логотип."
    : editOptions.background === "transparent"
      ? "Preserve a fully transparent background in the result. If the user asks to remove an object, do not insert a replacement object into the selected area; restore transparency there."
      : "";
  const placementInstruction = logo && !exactOverlay ? logoPlacementInstruction(options.logoPlacement, options.logoPosition) : "";
  const editModel = purpose === "edit"
    ? process.env.KLIO_IMAGE_EDIT_MODEL?.trim() || "gpt-image-2.5-sunburst"
    : undefined;
  const referenceInstruction = references.length
    ? referenceRoles[0] === "style"
      ? "Второе изображение — референс стиля обработки. Перенеси на исходник визуальный язык референса: свет, цвет, контраст, фактуру, глубину резкости и характер съёмки. Не копируй из него людей, предметы, фон или композицию, если пользователь явно этого не попросил. Исходный объект и его форма должны остаться основой результата."
      : "Второе изображение — дополнительный визуальный референс объекта. Используй его только для объекта, стиля или деталей, указанных в запросе; не копируй его фон целиком и не заменяй им основную сцену."
    : "";
  const providerInputs = [source, ...references, ...(logo && !exactOverlay ? [logo] : [])];
  if (providerInputs.length > 2) throw new ImageInputError("Для этого запуска можно использовать исходник и один дополнительный референс. Отключите логотип или уберите лишнее изображение.");
  const { bytes, contentType } = await generateImageBytes(`${instruction}\n${maskInstruction}\n${backgroundInstruction}\n\n${prompt}\n\n${referenceInstruction}\n${logoInstruction}\n${placementInstruction}`, requestId,
    editOptions,
    providerInputs.length > 1 ? providerInputs : source, editModel, mask, mask ? undefined : onPartial, onUsage);

  // The provider treats an edit mask as guidance and can still change pixels
  // outside it. Lock those pixels locally: only let generated pixels through
  // the transparent (painted) part of the user's mask.
  if (mask && purpose === "edit") {
    const sharp = (await import("sharp")).default;
    const [sourceMetadata, resultMetadata] = await Promise.all([
      sharp(source.bytes).metadata(),
      sharp(bytes).metadata(),
    ]);
    if (!sourceMetadata.width || !sourceMetadata.height || !resultMetadata.width || !resultMetadata.height)
      throw new ImageInputError("Не удалось совместить результат с выделением. Попробуйте запустить доработку ещё раз.");

    const width = sourceMetadata.width;
    const height = sourceMetadata.height;
    const selectedAreaAlpha = await sharp(mask.bytes)
      .extractChannel("alpha")
      .negate()
      .raw()
      .toBuffer();
    const softenedAlpha = await sharp(selectedAreaAlpha, { raw: { width, height, channels: 1 } })
      .blur(2)
      .raw()
      .toBuffer();
    // Soften only the inside edge; never let generated pixels leak outside
    // the user's painted selection.
    for (let index = 0; index < selectedAreaAlpha.length; index += 1)
      selectedAreaAlpha[index] = Math.min(selectedAreaAlpha[index], softenedAlpha[index]);
    // Keep any alpha returned by the provider. Removing it here turned a
    // transparent edit into opaque black pixels inside the painted area.
    const generatedRgba = await sharp(bytes)
      .rotate()
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let index = 0; index < selectedAreaAlpha.length; index += 1) {
      const alphaIndex = index * 4 + 3;
      generatedRgba[alphaIndex] = Math.min(generatedRgba[alphaIndex], selectedAreaAlpha[index]);
    }
    const generatedLayer = await sharp(generatedRgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    // Clear the source under the mask before compositing. A transparent
    // generated pixel cannot erase an opaque source pixel when it is simply
    // composited over it; this was why removed objects could reappear.
    const sourceRgba = await sharp(source.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let index = 0; index < selectedAreaAlpha.length; index += 1) {
      const alphaIndex = index * 4 + 3;
      sourceRgba[alphaIndex] = Math.round(sourceRgba[alphaIndex] * (255 - selectedAreaAlpha[index]) / 255);
    }
    const clearedSource = await sharp(sourceRgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const lockedResult = await sharp(clearedSource)
      .composite([{ input: generatedLayer, left: 0, top: 0, blend: "over" }])
      .png()
      .toBuffer();
    return uploadPublicationImage(new File([lockedResult], "klio-edit.png", { type: "image/png" }), email, baseUrl);
  }

  const result = exactOverlay && logo ? await overlayOriginalLogo(bytes, logo, options) : { bytes, contentType };
  return uploadPublicationImage(new File([result.bytes], `klio-edit.${fileExtension(result.contentType)}`, { type: result.contentType }), email, baseUrl);
}

function logoPositionLabel(position: LogoPosition = "bottom-right") {
  return { "top-left": "слева вверху", "top-right": "справа вверху", "bottom-left": "слева внизу", "bottom-right": "справа внизу" }[position];
}

function fileExtension(contentType: string) {
  return contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
}

async function overlayOriginalLogo(
  imageBytes: Uint8Array<ArrayBuffer>,
  logo: ImageInput,
  options: ImageGenerationOptions,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  const sharp = (await import("sharp")).default;
  const outputFormat = options.outputFormat || "png";
  const base = sharp(imageBytes).rotate();
  const metadata = await base.metadata();
  if (!metadata.width || !metadata.height) throw new ImageInputError("Не удалось добавить исходный логотип к изображению.");
  const marginX = Math.max(1, Math.round(metadata.width * 0.04));
  const marginY = Math.max(1, Math.round(metadata.height * 0.04));
  const logoBytes = await sharp(logo.bytes)
    .rotate()
    .resize({ width: Math.max(1, Math.round(metadata.width * 0.14)), height: Math.max(1, Math.round(metadata.height * 0.14)), fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .png()
    .toBuffer();
  const logoMetadata = await sharp(logoBytes).metadata();
  if (!logoMetadata.width || !logoMetadata.height) throw new ImageInputError("Не удалось прочитать исходный файл логотипа.");
  const position = options.logoPosition || "bottom-right";
  const left = position.endsWith("left") ? marginX : metadata.width - logoMetadata.width - marginX;
  const top = position.startsWith("top") ? marginY : metadata.height - logoMetadata.height - marginY;
  const composed = base.composite([{ input: logoBytes, left, top, blend: "over" }]);
  if (outputFormat === "jpeg") return { bytes: Uint8Array.from(await composed.jpeg({ quality: 95, mozjpeg: true }).toBuffer()), contentType: "image/jpeg" };
  if (outputFormat === "webp") return { bytes: Uint8Array.from(await composed.webp({ quality: 95, alphaQuality: 100 }).toBuffer()), contentType: "image/webp" };
  return { bytes: Uint8Array.from(await composed.png().toBuffer()), contentType: "image/png" };
}

// Technical enhancement buttons must not send the whole photograph through a
// generative edit: that can redraw faces, hair and other identity-bearing
// details. Keep these operations pixel-preserving and deterministic with
// Sharp. Creative operations (background replacement, object removal, sky
// replacement) continue through the image model below.
export async function createLocalImageEdit(
  source: ImageInput,
  operation: LocalImageEditOperation,
  email: string,
  baseUrl: string,
) {
  const sharp = (await import("sharp")).default;
  let pipeline = sharp(source.bytes).rotate();
  if (operation === "auto-correction") {
    pipeline = pipeline.normalize().modulate({ brightness: 1.03, saturation: 1.03 }).sharpen({ sigma: 0.55, m1: 0.35, m2: 1.1 });
  } else if (operation === "denoise") {
    pipeline = pipeline.median(3).sharpen({ sigma: 0.45, m1: 0.3, m2: 0.9 });
  } else if (operation === "sharpen") {
    pipeline = pipeline.sharpen({ sigma: 1, m1: 0.7, m2: 1.6 });
  } else {
    pipeline = pipeline.modulate({ brightness: 1.02, saturation: 1.01 }).sharpen({ sigma: 0.55, m1: 0.3, m2: 1 });
  }
  // PNG/WebP keep an existing transparent background. JPEG would flatten it,
  // so local edits always use PNG as the lossless archival format.
  const bytes = await pipeline.png().toBuffer();
  return uploadPublicationImage(new File([bytes], "klio-local-edit.png", { type: "image/png" }), email, baseUrl);
}

// Each carousel card is generated as a complete raster image by the image
// model: scene, layout, and exact Russian copy are all in its prompt. The
// optional reference is only the brand logo, never a preceding slide.
export async function createCarouselSlideImage(
  prompt: string,
  reference: { bytes: Uint8Array<ArrayBuffer>; contentType: string; kind: "logo" } | undefined,
  email: string,
  baseUrl: string,
  requestId: string,
  options: ImageGenerationOptions,
  model: string,
  slideCopy?: { headline: string; subtext: string; templateId: CarouselTemplateId; indicatorMode?: CarouselSlideIndicatorMode; slideIndex?: number; slideTotal?: number },
  onUsage?: ImageUsageHandler,
) {
  const guidedPrompt = prompt;
  const imagePrompt = slideCopy
    ? [
        guidedPrompt,
        `Сгенерируй целое готовое изображение слайда: саму сцену, арт-дирекцию, сетку, типографику и текст. Не используй готовый фон и не накладывай текст отдельным этапом. Встрой на изображение точный русский текст. Заголовок напиши без замены букв, сокращений и дополнительных слов: «${slideCopy.headline}». Основной текст напиши точно и полностью: «${slideCopy.subtext}».`,
        `Выбранный стиль «${slideCopy.templateId}»: ${carouselTemplateInstruction(slideCopy.templateId)}`,
        "Текст является частью цельной композиции, а не отдельной большой плашкой: крупный ясный заголовок и короткий читаемый абзац, оба с безопасными полями и высоким контрастом. Используй настоящую кириллицу, без псевдотекста. Не добавляй другого текста, подписей, цифр и случайных символов.",
        carouselSlideIndicatorInstruction(slideCopy.indicatorMode, slideCopy.slideIndex ?? 0, slideCopy.slideTotal ?? 1),
        reference?.kind === "logo" ? CAROUSEL_LOGO_REFERENCE_INSTRUCTION : "",
      ].filter(Boolean).join("\n\n")
    : guidedPrompt;
  const generated = await generateImageBytes(imagePrompt, requestId, options, reference, model, undefined, undefined, onUsage);
  const { bytes, contentType } = generated;
  const fileName = contentType === "image/jpeg" ? "klio.jpeg" : contentType === "image/webp" ? "klio.webp" : contentType === "image/gif" ? "klio.gif" : "klio.png";
  const url = await uploadPublicationImage(
    new File([bytes], fileName, { type: contentType }),
    email,
    baseUrl,
  );
  return { url, bytes, contentType };
}

