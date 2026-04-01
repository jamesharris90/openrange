import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/", "/login", "/screener-v2"]);
const ADMIN_PREFIX = "/admin";

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/research-v2/");
}

function decodeUserFromToken(token: string): { is_admin?: number | boolean } | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { is_admin?: number | boolean };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get("token")?.value;

  // Redirect authenticated users away from login → dashboard
  if (pathname === "/login" && token) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Public paths always accessible
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // All other platform routes require auth
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  // Admin routes require is_admin flag in JWT
  if (pathname.startsWith(ADMIN_PREFIX)) {
    const user = decodeUserFromToken(token);
    const isAdmin = Boolean(user?.is_admin === true || user?.is_admin === 1);
    if (!isAdmin) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts|api/).*)",
  ],
};
