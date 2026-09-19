import { and, eq } from "drizzle-orm";
import { brands, generations } from "../../../db/schema";
import { imageConfigured, createImage, parseImageGenerationOptions } from "../_lib/image-generation";
import { readBoundedJson, RequestBodyError } from "../_lib/request-body";
import { hasUnsafeRequestOrigin } from "../_lib/request-origin";
import { isRateLimited } from "../_lib/rate-limit";
import { resolveBaseUrl } from "../_lib/base-url";
import { assertGenerationQuotaAvailable, getWorkspaceDb, recordGeneration, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  try {
    if (hasUnsafeRequestOrigin(request)) return Response.json({ error: "Недопустимый источник запроса." }, { status: 403 });
    const user = await workspaceIdentity();
    const input = await readBoundedJson(request, 8192);
    const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1800) : "";
    const brandId = typeof input.brandId === "string" ? input.brandId.trim() : "";
    const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
    const imageOptions = parseImageGenerationOptions(input);
    if (!prompt || prompt.length < 8) return Response.json({ error: "Опишите изображение подробнее." }, { status: 400 });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return Response.json({ error: "Некорректный запрос." }, { status: 400 });
    const db = await getWorkspaceDb();
    const [existing] = await db.select().from(generations).where(and(eq(generations.id, requestId), eq(generations.ownerEmail, user.email))).limit(1);
    if (existing) return Response.json({ generation: existing });
    if (!imageConfigured()) return Response.json({ error: "Генерация изображений пока недоступна." }, { status: 503 });
    if (isRateLimited(`images:${user.email}`, 4, 60_000)) return Response.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429 });
    await assertGenerationQuotaAvailable(brandId || undefined);
    let brandContext = "";
    if (brandId) {
      const [brand] = await db.select({ profileJson: brands.profileJson }).from(brands).where(and(eq(brands.id, brandId), eq(brands.ownerEmail, user.email))).limit(1);
      if (!brand) throw new WorkspaceAccessError("Бренд не найден.", 404);
      brandContext = `\nКонтекст бренда: ${brand.profileJson.slice(0, 4000)}`;
    }
    const imageUrl = await createImage(`${prompt}${brandContext}`, user.email, new URL(resolveBaseUrl(request)).origin, requestId, imageOptions);
    const usage = await recordGeneration({
      id: requestId,
      brandId: brandId || undefined,
      format: "external",
      topic: "Изображение",
      title: prompt.slice(0, 100),
      body: prompt,
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
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Image generation failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Не удалось создать изображение. Попробуйте ещё раз." }, { status: 502 });
  }
}
