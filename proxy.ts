import { NextResponse } from "next/server";
import { hasUnsafeRequestOrigin } from "./app/api/_lib/request-origin";

// The site-wide shared password (APP_ACCESS_USER/APP_ACCESS_PASSWORD) was
// removed once real per-visitor accounts (email + password, see
// app/site-auth.ts) took over guarding /workspace and /api/*. Access control
// now lives at the page/route level via app/identity.ts.
export function proxy(request: Request) {
  if (hasUnsafeRequestOrigin(request)) return NextResponse.json({ error: "Запрос с другого сайта отклонён." }, { status: 403 });
  return NextResponse.next();
}

export const config = {
  matcher: ["/workspace/:path*", "/api/:path*"],
};
