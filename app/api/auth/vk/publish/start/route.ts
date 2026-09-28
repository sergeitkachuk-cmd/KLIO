import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../../../db";
import { socialChannels } from "../../../../../../db/schema";
import { resolveBaseUrl } from "../../../../_lib/base-url";
import { workspaceIdentity, WorkspaceAccessError } from "../../../../_lib/workspace-account";
import { VK_AUTHORIZE_URL, VK_PUBLISH_SCOPE, generatePkceVerifier, pkceChallengeFromVerifier, vkOAuthConfigured } from "../../../../_lib/vk-oauth";

// "Войти через VK" for an *already-connected* VK channel (see the
// publications-channel-chip button in textora-experience.tsx), not a fresh
// connection: this only ever adds photoAccessToken/photoRefreshToken to an
// existing socialChannels row that already has a working community
// accessToken + groupId. See the long comment on VkCredentials.
// photoAccessToken in publishing-config.ts for why a second token is
// needed at all.
const STATE_COOKIE = "klio_vkpub_state";
const VERIFIER_COOKIE = "klio_vkpub_verifier";
const CHANNEL_COOKIE = "klio_vkpub_channel";
const COOKIE_TTL_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);
  const failureRedirect = `${baseUrl}/workspace?vk_photo=error#publications`;

  if (!vkOAuthConfigured()) return NextResponse.redirect(failureRedirect);

  let ownerEmail: string;
  try {
    ownerEmail = (await workspaceIdentity()).email;
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return NextResponse.redirect(`${baseUrl}/login`);
    return NextResponse.redirect(failureRedirect);
  }

  const url = new URL(request.url);
  const channelId = (url.searchParams.get("channelId") || "").trim();
  if (!channelId) return NextResponse.redirect(failureRedirect);

  // Confirms ownership up front so a stolen/guessed channelId can't be used
  // to attach someone else's VK session to this channel's credentials —
  // the callback re-checks this again right before writing, since a lot can
  // happen during the VK consent round trip.
  const db = getDb();
  const [channel] = await db.select({ ownerEmail: socialChannels.ownerEmail, platform: socialChannels.platform }).from(socialChannels)
    .where(eq(socialChannels.id, channelId)).limit(1);
  if (!channel || channel.platform !== "vk" || channel.ownerEmail !== ownerEmail) return NextResponse.redirect(failureRedirect);

  const state = randomBytes(24).toString("hex");
  const codeVerifier = generatePkceVerifier();
  const codeChallenge = pkceChallengeFromVerifier(codeVerifier);
  const redirectUri = new URL("/api/auth/vk/publish/callback", baseUrl).href;

  const authorizeUrl = new URL(VK_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", process.env.VK_OAUTH_CLIENT_ID!.trim());
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", VK_PUBLISH_SCOPE);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl.toString());
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_TTL_SECONDS,
  };
  response.cookies.set(STATE_COOKIE, state, cookieOptions);
  response.cookies.set(VERIFIER_COOKIE, codeVerifier, cookieOptions);
  response.cookies.set(CHANNEL_COOKIE, channelId, cookieOptions);
  return response;
}
