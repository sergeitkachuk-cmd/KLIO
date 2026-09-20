// Brand logo: upload (POST) and authenticated read-back (GET) - lets image
// generation attach the real file via OpenAI's edit endpoint instead of
// the model inventing a logo from the prompt alone (see createImageFromLogo
// in api/_lib/image-generation.ts). Same private-S3-key pattern as
// api/brand/book/route.ts: the object is never public, only ever read back
// by our own server, either for the profile page's own <img> preview or for
// attaching the bytes to a generation request.

import { and, eq } from "drizzle-orm";
import { brands } from "../../../../db/schema";
import { getWorkspaceDb, workspaceDatabaseAvailable, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { downloadBrandLogo, uploadBrandLogo, StorageError } from "../../_lib/storage";
import { readBoundedBody, RequestBodyError } from "../../_lib/request-body";
import { isRateLimited } from "../../_lib/rate-limit";

export async function GET(request: Request) {
  try {
    if (!await workspaceDatabaseAvailable()) return Response.json({ error: "Хранилище кабинета недоступно." }, { status: 503 });
    const user = await workspaceIdentity();
    const brandId = new URL(request.url).searchParams.get("brandId")?.trim() || "";
    if (!brandId) return Response.json({ error: "Не указан бренд." }, { status: 400 });

    const db = await getWorkspaceDb();
    const [brand] = await db.select({ profileJson: brands.profileJson })
      .from(brands)
      .where(and(eq(brands.id, brandId), eq(brands.ownerEmail, user.email)))
      .limit(1);
    if (!brand) return Response.json({ error: "Бренд не найден или недоступен." }, { status: 404 });

    const profile = JSON.parse(brand.profileJson) as { logoKey?: unknown };
    const key = typeof profile.logoKey === "string" ? profile.logoKey : "";
    if (!key) return Response.json({ error: "Логотип не прикреплён." }, { status: 404 });

    const { bytes, contentType } = await downloadBrandLogo(key);
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await workspaceIdentity();
    if (isRateLimited(`brand-logo:${user.email}`, 20, 60_000)) return Response.json({ error: "Слишком много загрузок. Подождите минуту." }, { status: 429 });
    const bytes = await readBoundedBody(request, 8 * 1024 * 1024 + 64 * 1024, 30_000);
    const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Файл не передан." }, { status: 400 });

    const uploaded = await uploadBrandLogo(file, user.email);
    const fileName = (typeof file.name === "string" && file.name.trim().slice(0, 200)) || "logo";
    return Response.json({ key: uploaded.key, fileName }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
