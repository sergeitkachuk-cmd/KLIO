import { redirect } from "next/navigation";
import { getChatGPTUser } from "./chatgpt-auth";
import { getSiteSessionUser } from "./site-auth";

export type CurrentUser = { email: string; displayName: string };

// Resolution order: a real visitor account (site-auth session) wins first,
// then the ChatGPT embed header (when KLIO runs inside a ChatGPT App),
// then — only outside production — the APP_USER_EMAIL dev fallback that
// getChatGPTUser() already applies internally.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const siteUser = await getSiteSessionUser();
  if (siteUser) return siteUser;

  const chatGptUser = await getChatGPTUser();
  if (chatGptUser) return { email: chatGptUser.email, displayName: chatGptUser.displayName };

  return null;
}

export async function requireCurrentUser(returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(loginPath(returnTo));
}

export function loginPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/login?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/workspace";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/workspace";
  }
  if (url.origin !== "https://app.local") return "/workspace";
  if (url.pathname === "/login" || url.pathname === "/signup") return "/workspace";

  return `${url.pathname}${url.search}${url.hash}`;
}
