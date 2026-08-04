import { eq } from "drizzle-orm";
import { accounts } from "../../../../db/schema";
import { verifyPassword } from "../../_lib/password";
import { createSiteSession } from "../../../site-auth";
import { getWorkspaceDb, workspaceDatabaseAvailable, workspaceErrorResponse } from "../../_lib/workspace-account";

type LoginPayload = { email?: unknown; password?: unknown };

const INVALID_CREDENTIALS = { error: "Неверный email или пароль." } as const;

export async function POST(request: Request) {
  try {
    if (!await workspaceDatabaseAvailable()) {
      return Response.json({ error: "Хранилище кабинета недоступно." }, { status: 503 });
    }

    const payload = await request.json() as LoginPayload;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 320) : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!email || !password) return Response.json(INVALID_CREDENTIALS, { status: 401 });

    const db = await getWorkspaceDb();
    const [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
    if (!account?.passwordHash) return Response.json(INVALID_CREDENTIALS, { status: 401 });

    const valid = await verifyPassword(password, account.passwordHash);
    if (!valid) return Response.json(INVALID_CREDENTIALS, { status: 401 });

    await createSiteSession(email);
    return Response.json({ user: { email: account.email, displayName: account.displayName } });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
