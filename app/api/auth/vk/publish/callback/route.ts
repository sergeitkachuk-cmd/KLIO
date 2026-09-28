import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { socialChannels } from "../../../../../../db/schema";
import { resolveBaseUrl } from "../../../../_lib/base-url";
import { workspaceIdentity, WorkspaceAccessError } from "../../../../_lib/workspace-account";
import { VK_TOKEN_URL, vkOAuthConfigured } from "../../../../_lib/vk-oauth";
import { verifyVkUserToken, ChannelValidationError } from "../../../../_lib/social-channels";
import type { ChannelCredentials } from "../../../../_lib/publishing-config";

const STATE_COOKIE = "klio_vkpub_state";
const VERIFIER_COOKIE = "klio_vkpub_verifier";
const CHANNEL_COOKIE = "klio_vkpub_channel";

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);
  const jar = await cookies();
  const savedState = jar.get(STATE_COOKIE)?.value;
  const codeVerifier = jar.get(VERIFIER_COOKIE)?.value;
  const channelId = jar.get(CHANNEL_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);
  jar.delete(CHANNEL_COOKIE);

  const fail = (message?: string) => NextResponse.redirect(
    `${baseUrl}/workspace?vk_photo=error${message ? `&vk_photo_message=${encodeURIComponent(message)}` : ""}#publications`,
  );

  if (!vkOAuthConfigured() || !channelId) return fail();

  let ownerEmail: string;
  try {
    ownerEmail = (await workspaceIdentity()).email;
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return NextResponse.redirect(`${baseUrl}/login`);
    return fail();
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // Same VK-issued, must-echo-back value as the sign-in callback — see the
  // comment in vk-oauth.ts. Persisted below alongside the refresh token,
  // since refreshVkAccessToken needs to send this same value back too.
  const deviceId = url.searchParams.get("device_id");
  if (!code || !state || !savedState || state !== savedState || !codeVerifier || !deviceId) return fail();

  try {
    const db = getDb();
    const [channel] = await db.select().from(socialChannels).where(eq(socialChannels.id, channelId)).limit(1);
    if (!channel || channel.platform !== "vk" || channel.ownerEmail !== ownerEmail) return fail();

    const existing = JSON.parse(channel.credentialsJson) as ChannelCredentials;
    if (existing.platform !== "vk") return fail();

    const redirectUri = new URL("/api/auth/vk/publish/callback", baseUrl).href;
    const tokenResponse = await fetch(VK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        client_id: process.env.VK_OAUTH_CLIENT_ID!.trim(),
        device_id: deviceId,
        redirect_uri: redirectUri,
        state,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!tokenResponse.ok) throw new Error(`token exchange failed: ${tokenResponse.status}`);
    const tokenPayload = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tokenPayload.access_token || !tokenPayload.refresh_token) throw new Error("token exchange returned no access_token/refresh_token");

    // Confirms the new token can actually see this exact community before
    // it's saved — a token for the wrong VK account (signed in as someone
    // who isn't this community's admin) would otherwise only fail later, at
    // the next real publish, with a much less actionable error.
    await verifyVkUserToken(tokenPayload.access_token, existing.vk.groupId);

    const expiresInSeconds = typeof tokenPayload.expires_in === "number" && tokenPayload.expires_in > 0 ? tokenPayload.expires_in : 3600;
    const updatedVk: ChannelCredentials = {
      platform: "vk",
      vk: {
        ...existing.vk,
        photoAccessToken: tokenPayload.access_token,
        photoRefreshToken: tokenPayload.refresh_token,
        photoTokenExpiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        photoDeviceId: deviceId,
      },
    };
    await db.update(socialChannels).set({
      credentialsJson: JSON.stringify(updatedVk),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(socialChannels.id, channelId));

    return NextResponse.redirect(`${baseUrl}/workspace?vk_photo=connected#publications`);
  } catch (error) {
    console.error("VK publish-photo OAuth failed", error instanceof Error ? error.message : error);
    return fail(error instanceof ChannelValidationError ? error.message : undefined);
  }
}
