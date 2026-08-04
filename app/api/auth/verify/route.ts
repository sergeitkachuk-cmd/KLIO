import { NextResponse } from "next/server";
import { createSiteSession } from "../../../site-auth";
import { consumeEmailVerification } from "../../_lib/verification";
import { workspaceDatabaseAvailable } from "../../_lib/workspace-account";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();

  if (!token || !await workspaceDatabaseAvailable()) {
    return NextResponse.redirect(new URL("/login?verify=failed", request.url));
  }

  try {
    const email = await consumeEmailVerification(token);
    if (!email) return NextResponse.redirect(new URL("/login?verify=expired", request.url));

    await createSiteSession(email);
    return NextResponse.redirect(new URL("/workspace", request.url));
  } catch (error) {
    console.error("Email verification failed", error);
    return NextResponse.redirect(new URL("/login?verify=failed", request.url));
  }
}
