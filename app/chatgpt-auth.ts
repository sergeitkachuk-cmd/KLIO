export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  // Public request headers are caller-controlled, never identity proof.
  // Production authentication must use the verified site session, including
  // sessions issued after server-side OAuth verification. Fail closed for any
  // environment other than explicitly selected development/test.
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") return null;
  const email = process.env.APP_USER_EMAIL?.trim();
  if (!email) return null;
  const name = process.env.APP_USER_NAME?.trim() || email;
  return { displayName: name, email, fullName: name };
}
