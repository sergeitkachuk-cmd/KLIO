// Account avatar: upload (POST), authenticated read-back (GET) and removal
// (DELETE) - same private-S3-key pattern as api/brand/logo/route.ts, just
// scoped to the signed-in account itself rather than a brandId param, since
// there's exactly one of these per person. Uploading one takes priority
// over any auto-captured providerAvatarUrl (Yandex/VK) - see the comment on
// accounts.avatarKey in db/schema.ts and accountSummary() in
// api/_lib/workspace-account.ts, which is what actually decides which of
// the two the client ends up shown.

import { eq } from "drizzle-orm";
import { accounts } from "../../../../db/schema";
import { getWorkspaceDb, workspaceDatabaseAvailable, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { downloadAccountAvatar, uploadAccountAvatar, StorageError } from "../../_lib/storage";
import { readBoundedBody, RequestBodyError } from "../../_lib/request-body";
import { isRateLimited } from "../../_lib/rate-limit";

export async function GET() {
  try {
    if (!await workspaceDatabaseAvailable()) return Response.json({ error: "Хранилище кабинета недоступно." }, { status: 503 });
    const user = await workspaceIdentity();

    const db = await getWorkspaceDb();
    const [account] = await db.select({ avatarKey: accounts.avatarKey }).from(accounts).where(eq(accounts.email, user.email)).limit(1);
    const key = account?.avatarKey || "";
    if (!key) return Response.json({ error: "Аватар не загружен." }, { status: 404 });

    const { bytes, contentType } = await downloadAccountAvatar(key);
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
    if (isRateLimited(`account-avatar:${user.email}`, 20, 60_000)) return Response.json({ error: "Слишком много загрузок. Подождите минуту." }, { status: 429 });
    const bytes = await readBoundedBody(request, 5 * 1024 * 1024 + 64 * 1024, 30_000);
    const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Файл не передан." }, { status: 400 });

    const uploaded = await uploadAccountAvatar(file, user.email);
    const fileName = (typeof file.name === "string" && file.name.trim().slice(0, 200)) || "avatar";

    const db = await getWorkspaceDb();
    await db.update(accounts).set({ avatarKey: uploaded.key, avatarFileName: fileName }).where(eq(accounts.email, user.email));

    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    await db.update(accounts).set({ avatarKey: null, avatarFileName: null }).where(eq(accounts.email, user.email));
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
