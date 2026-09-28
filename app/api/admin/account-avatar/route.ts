// Serves a specific customer's uploaded avatar to the admin panel.
// api/account/avatar only ever serves whoever is currently signed in (no
// email param, keyed by session) - no good for /admin, which needs to show
// *other* people's pictures in the users table and Обращения threads. Same
// download path (downloadAccountAvatar), just keyed by an ?email= query
// param instead, gated the same way every other /api/admin/* route is.
import { eq } from "drizzle-orm";
import { getCurrentUser } from "../../../identity";
import { isAdminEmail } from "../../_lib/admin";
import { getDb } from "../../../../db";
import { accounts } from "../../../../db/schema";
import { downloadAccountAvatar, StorageError } from "../../_lib/storage";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Недоступно" }, { status: 403 });

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() || "";
  if (!email) return Response.json({ error: "Не указан email." }, { status: 400 });

  try {
    const db = getDb();
    const [account] = await db.select({ avatarKey: accounts.avatarKey }).from(accounts).where(eq(accounts.email, email)).limit(1);
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
    console.error("Admin account-avatar download failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Не удалось загрузить аватар." }, { status: 502 });
  }
}
