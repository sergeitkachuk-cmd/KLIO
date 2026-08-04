import { NextResponse } from "next/server";
import { resolveBaseUrl } from "../../_lib/base-url";
import { createSiteSession } from "../../../site-auth";
import { consumeEmailVerification } from "../../_lib/verification";
import { workspaceDatabaseAvailable } from "../../_lib/workspace-account";

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();

  if (!token || !await workspaceDatabaseAvailable()) {
    return NextResponse.redirect(`${baseUrl}/login?verify=failed`);
  }

  try {
    const email = await consumeEmailVerification(token);
    if (!email) return NextResponse.redirect(`${baseUrl}/login?verify=expired`);

    await createSiteSession(email);
    return NextResponse.redirect(`${baseUrl}/workspace`);
  } catch (error) {
    console.error("Email verification failed", error);
    return NextResponse.redirect(`${baseUrl}/login?verify=failed`);
  }
}
