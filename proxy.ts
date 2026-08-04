import { type NextRequest, NextResponse } from "next/server";

// The site-wide shared password (APP_ACCESS_USER/APP_ACCESS_PASSWORD) was
// removed once real per-visitor accounts (email + password, see
// app/site-auth.ts) took over guarding /workspace and /api/*. Access control
// now lives at the page/route level via app/identity.ts.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/workspace/:path*", "/api/:path*"],
};
