import { redirect } from "next/navigation";
import { getChatGPTUser } from "./chatgpt-auth";
import { getSiteSessionUser } from "./site-auth";

export type CurrentUser = { email: string; displayName: string };

// Verified site sessions are the only production identity. The legacy helper
// supplies an environment-configured local developer identity only; it never
// trusts HTTP headers.
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
