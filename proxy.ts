import { type NextRequest, NextResponse } from "next/server";

function unauthorized(message = "Требуется авторизация") {
  return new NextResponse(message, {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="KLIO", charset="UTF-8"' },
  });
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/ai-status") return NextResponse.next();

  const expectedPassword = process.env.APP_ACCESS_PASSWORD?.trim();
  if (!expectedPassword) {
    return new NextResponse("APP_ACCESS_PASSWORD не настроен", { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return unauthorized();

  try {
    const credentials = atob(authorization.slice(6));
    const separator = credentials.indexOf(":");
    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);
    const expectedUser = process.env.APP_ACCESS_USER?.trim() || "klio";
    if (separator < 0 || username !== expectedUser || password !== expectedPassword) {
      return unauthorized("Неверный логин или пароль");
    }
  } catch {
    return unauthorized("Неверный заголовок авторизации");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/workspace/:path*", "/api/:path*"],
};
