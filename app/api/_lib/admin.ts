// Gate for the owner-only /admin dashboard. Deliberately not tied to any
// plan or role stored in the database — it's a fixed allowlist of emails
// set outside the app (Render env), so it can never be granted to a
// visitor account by mistake.
import { getCurrentUser } from "../../identity";

function adminEmailAllowlist(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string): boolean {
  return adminEmailAllowlist().has(email.trim().toLowerCase());
}

export async function requireAdminUser() {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
}
