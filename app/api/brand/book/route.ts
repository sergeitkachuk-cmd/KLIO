// Streams an attached brand book back through our own server rather than
// a public S3 URL — see uploadBrandBookPdf's own comment on why the object
// is never public. Owner-scoped: the key lives inside the brand's own
// profileJson, reached only after confirming the requester owns that
// brand row (never trusts a client-supplied key directly).

import { and, eq } from "drizzle-orm";
import { brands } from "../../../../db/schema";
import { getWorkspaceDb, workspaceDatabaseAvailable, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { downloadBrandBookPdf, StorageError } from "../../_lib/storage";

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

    const profile = JSON.parse(brand.profileJson) as { brandBookKey?: unknown; brandBookFileName?: unknown };
    const key = typeof profile.brandBookKey === "string" ? profile.brandBookKey : "";
    if (!key) return Response.json({ error: "Брендбук не прикреплён." }, { status: 404 });

    const bytes = await downloadBrandBookPdf(key);
    const fileName = typeof profile.brandBookFileName === "string" && profile.brandBookFileName.trim() ? profile.brandBookFileName.trim() : "brandbook.pdf";
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="brandbook.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
