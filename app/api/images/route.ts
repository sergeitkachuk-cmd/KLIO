import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { brands, generations } from "../../../db/schema";
import { imageConfigured, createImage, createImageFromLogo, createImageFromSource, parseImageGenerationOptions } from "../_lib/image-generation";
import { downloadBrandLogo, downloadPublicationImage, StorageError } from "../_lib/storage";
import { dialogueImageTextInstruction } from "../_lib/dialogue-image-prompt";
import { readBoundedJson, RequestBodyError } from "../_lib/request-body";
import { hasUnsafeRequestOrigin } from "../_lib/request-origin";
import { isRateLimited } from "../_lib/rate-limit";
import { resolveBaseUrl } from "../_lib/base-url";
import { assertGenerationQuotaAvailable, getWorkspaceDb, recordGeneration, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";
import { IMAGE_STYLE_OPTIONS } from "../../dialogue-generation-settings";
import { imageContentType } from "../_lib/image-type";
import { recordImageUsage } from "../_lib/image-usage";

export const runtime = "nodejs";
export const maxDuration = 240;

async function handleImageRequest(request: Request, onPartial?: (image: string) => void) {
  try {
    if (hasUnsafeRequestOrigin(request)) return Response.json({ error: "Недопустимый источник запроса." }, { status: 403 });
    const user = await workspaceIdentity();
    const input = await readBoundedJson(request, 5 * 1024 * 1024);
    const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1800) : "";
    let sourceTitle = typeof input.sourceTitle === "string" ? input.sourceTitle.trim().slice(0, 500) : "";
    const brandId = typeof input.brandId === "string" ? input.brandId.trim() : "";
    const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
    const sourceImageGenerationId = typeof input.sourceImageGenerationId === "string" ? input.sourceImageGenerationId.trim() : "";
    const sourceImageUrl = typeof input.sourceImageUrl === "string" ? input.sourceImageUrl.trim().slice(0, 600) : "";
    const sourceImagePurpose = input.sourceImagePurpose === "reference" ? "reference" : "edit";
    const imageOptions = parseImageGenerationOptions(input);
    const imageStyle = typeof input.imageStyle === "string"
      ? IMAGE_STYLE_OPTIONS.find(option => option.value === input.imageStyle)?.instruction || ""
      : "";
    const useLogo = input.useLogo === true;
    let editMask: { bytes: Uint8Array<ArrayBuffer>; contentType: string } | undefined;
    if (typeof input.imageEditMask === "string" && input.imageEditMask) {
      const encoded = input.imageEditMask;
      if (encoded.length > 4_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return Response.json({ error: "Маска слишком большая или повреждена. Сбросьте выделение и попробуйте ещё раз." }, { status: 413 });
      const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
      const contentType = imageContentType(bytes);
      if (contentType !== "image/png") return Response.json({ error: "Маска области должна быть PNG." }, { status: 400 });
      editMask = { bytes, contentType };
    }
    if (editMask && (!sourceImageGenerationId && !sourceImageUrl || sourceImagePurpose !== "edit" || useLogo)) return Response.json({ error: "Кисть работает только при редактировании выбранного изображения без логотипа." }, { status: 400 });
    const imageTextMode = input.imageTextMode === "none" || input.imageTextMode === "title" || input.imageTextMode === "custom" ? input.imageTextMode : "auto";
    const imageText = typeof input.imageText === "string" ? input.imageText.trim() : "";
    if (imageTextMode === "custom" && (!imageText || imageText.length > 200)) return Response.json({ error: "Введите текст для изображения: от 1 до 200 символов." }, { status: 400 });
    if (!prompt || prompt.length < 8) return Response.json({ error: "Опишите изображение подробнее." }, { status: 400 });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return Response.json({ error: "Некорректный запрос." }, { status: 400 });
    const db = await getWorkspaceDb();
    const [existing] = await db.select().from(generations).where(and(eq(generations.id, requestId), eq(generations.ownerEmail, user.email))).limit(1);
    if (existing) return Response.json({ generation: existing });
    if (sourceImageGenerationId && sourceImageUrl) return Response.json({ error: "Выберите сохранённое изображение или загрузите файл, но не оба источника сразу." }, { status: 400 });
    if (typeof input.sourceGenerationId === "string" && input.sourceGenerationId) {
      const [source] = await db.select({ title: generations.title }).from(generations).where(and(eq(generations.id, input.sourceGenerationId), eq(generations.ownerEmail, user.email))).limit(1);
      if (!source) throw new WorkspaceAccessError("Исходный материал не найден.", 404);
      // The review can contain a manually edited title not yet saved to Materials.
      // Verify ownership, but keep the exact title the person saw and confirmed.
      sourceTitle = sourceTitle || source.title.slice(0, 500);
    }
    if (imageTextMode === "title" && !sourceTitle) return Response.json({ error: "Выберите материал с заголовком или режим «Свой текст»." }, { status: 400 });
    if (!imageConfigured()) return Response.json({ error: "Генерация изображений пока недоступна." }, { status: 503 });
    if (isRateLimited(`images:${user.email}`, 4, 60_000)) return Response.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
    await assertGenerationQuotaAvailable(brandId || undefined);
    let brandContext = "";
    let logoKey = "";
    if (brandId) {
      const [brand] = await db.select({ profileJson: brands.profileJson }).from(brands).where(and(eq(brands.id, brandId), eq(brands.ownerEmail, user.email))).limit(1);
      if (!brand) throw new WorkspaceAccessError("Бренд не найден.", 404);
      // The brand-context JSON is the same for every image request for
      // this brand, while the actual per-article prompt is often shorter -
      // with no steering, that made the model settle on one "safe" generic
      // scene for the brand (site owner: 7 completely different articles
      // for two different brands each rendered as the same laptop-mug-
      // plant desk mockup / phone-with-chat scene, every time). The profile
      // is genuinely still needed for style/palette/tone consistency - the
      // fix is telling the model what NOT to keep repeating, not removing it.
      brandContext = `\n\nКонтекст бренда (используй для стиля, палитры и общего тона — не для повторения одной и той же сцены): ${brand.profileJson.slice(0, 4000)}\n\nВажно: сюжет и композиция изображения должны отражать именно тему конкретного запроса выше. Не изображай один и тот же шаблон (например, «рабочий стол с ноутбуком и фирменной кружкой») для каждого запроса этого бренда — придумывай разную визуальную идею под разную тему.`;
      if (useLogo) {
        const profile = JSON.parse(brand.profileJson) as { logoKey?: unknown };
        if (typeof profile.logoKey === "string") logoKey = profile.logoKey;
      }
    }
    const baseUrl = new URL(resolveBaseUrl(request)).origin;
    let sourceImage: { bytes: Uint8Array<ArrayBuffer>; contentType: string } | undefined;
    let resolvedSourceImageUrl = sourceImageUrl;
    if (sourceImageGenerationId) {
      const [source] = await db.select({ imageUrl: generations.imageUrl })
        .from(generations)
        .where(and(eq(generations.id, sourceImageGenerationId), eq(generations.ownerEmail, user.email)))
        .limit(1);
      if (!source?.imageUrl) throw new WorkspaceAccessError("Сохранённое исходное изображение не найдено.", 404);
      resolvedSourceImageUrl = source.imageUrl;
    }
    if (resolvedSourceImageUrl) {
      let parsed: URL;
      try { parsed = new URL(resolvedSourceImageUrl, baseUrl); } catch { throw new WorkspaceAccessError("Исходное изображение недоступно.", 400); }
      const match = /^\/api\/uploads\/(publications\/([a-f0-9]{64})\/[a-f0-9-]{36}\.(?:png|jpg|webp|gif))$/i.exec(parsed.pathname);
      const ownerKey = createHash("sha256").update(user.email.trim().toLowerCase()).digest("hex");
      // Never fetch an arbitrary URL supplied by the browser. The upload route
      // is owner-scoped, and the object is read directly from our S3 bucket.
      if (!/^https?:$/.test(parsed.protocol) || !match || match[2] !== ownerKey)
        throw new WorkspaceAccessError("Выберите своё изображение или загрузите файл заново.", 400);
      sourceImage = await downloadPublicationImage(match[1]);
    }
    if (useLogo && !logoKey) throw new WorkspaceAccessError("Добавьте логотип в профиль бренда или отключите его использование.", 400);
    const finalPrompt = `${prompt}${brandContext}${imageStyle ? `\n\nСтиль изображения: ${imageStyle}` : ""}\n\n${dialogueImageTextInstruction(imageTextMode, imageTextMode === "title" ? sourceTitle : imageText, Boolean(sourceImage) && sourceImagePurpose === "edit", useLogo)}`;
    const imageStartedAt = Date.now();
    let imageUrl: string;
    try {
      imageUrl = sourceImage
        ? await createImageFromSource(finalPrompt, sourceImage, sourceImagePurpose,
          useLogo && logoKey ? await downloadBrandLogo(logoKey) : undefined,
          user.email, baseUrl, requestId, imageOptions, editMask, onPartial)
        : useLogo && logoKey
        ? await createImageFromLogo(finalPrompt, await downloadBrandLogo(logoKey), user.email, baseUrl, requestId, imageOptions, undefined, onPartial)
        : await createImage(finalPrompt, user.email, baseUrl, requestId, imageOptions, undefined, onPartial);
      await recordImageUsage({ ownerEmail: user.email, requestId, operation: "generate_image", durationMs: Date.now() - imageStartedAt, status: "success" });
    } catch (error) {
      await recordImageUsage({ ownerEmail: user.email, requestId, operation: "generate_image", durationMs: Date.now() - imageStartedAt, status: "failed", errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    // When this call is a cover image for an existing article/material
    // (textora-experience.tsx's buildArticleImagePrompt), prompt is that
    // whole title+subtitle+body concatenated - fine as an image prompt,
    // but saving it verbatim as this new material's own title/body made
    // the title show a truncated two-line run-on and the body a mangled
    // duplicate of the source article (site owner screenshot: garbled
    // title, body cut off mid-word). sourceTitle carries the real title
    // separately so this material can be labeled sensibly instead.
    const usage = await recordGeneration({
      id: requestId,
      brandId: brandId || undefined,
      format: "external",
      topic: "Изображение",
      title: (sourceTitle ? `Обложка: ${sourceTitle}` : prompt).slice(0, 100),
      body: sourceTitle ? "" : prompt,
      subtitle: "",
      metaTitle: "",
      metaDescription: "",
      editorialComment: "",
      keywords: "",
      tone: "",
      targetLength: 0,
      imageUrl,
    });
    if (!usage) throw new Error("Не удалось сохранить изображение.");
    return Response.json({ generation: usage.archive, account: usage.account });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Image generation failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Не удалось создать изображение. Попробуйте ещё раз." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!request.headers.get("accept")?.includes("text/event-stream")) return handleImageRequest(request);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      void handleImageRequest(request, image => emit("partial", { image })).then(async response => {
        const payload = await response.json().catch(() => ({}));
        emit(response.ok ? "result" : "error", payload);
      }).catch(error => emit("error", { error: error instanceof Error ? error.message : "Image generation failed" })).finally(() => controller.close());
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
