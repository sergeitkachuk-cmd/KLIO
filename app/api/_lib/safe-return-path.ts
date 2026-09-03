// Clamps an arbitrary redirect target to a same-origin relative path, so a
// `return_to` carried through login can't be used to bounce a visitor
// off-site after authenticating (open-redirect). Mirrors the equivalent
// inline helpers in app/identity.ts and app/chatgpt-auth.ts — kept as its
// own module rather than merged into either since this is the first case
// a plain API route (not a page or the ChatGPT embed flow) needs it too.
export function safeReturnPath(value: string | null | undefined, fallback = "/workspace"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return fallback;
    if (url.pathname === "/login" || url.pathname === "/signup") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
