import { NextRequest, NextResponse } from "next/server";

function getToken(req: NextRequest): string | null {
  // Single “source of truth” cookie name we will set on login.
  const cookie =
    req.cookies.get("rtai_token")?.value ||
    req.cookies.get("accessToken")?.value ||
    req.cookies.get("token")?.value;
  return cookie || null;
}

// JWT uses base64url, not plain base64.
function base64UrlToBase64(input: string) {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  return (input + pad).replace(/-/g, "+").replace(/_/g, "/");
}

function decode(token: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const json = Buffer.from(base64UrlToBase64(payload), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ALWAYS-PUBLIC routes (never redirect)
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname.startsWith("/apply") ||
    pathname.startsWith("/contact") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/about") ||
    pathname.startsWith("/faq") ||
    pathname.startsWith("/blog") ||
    pathname.startsWith("/thanks")
  ) {
    return NextResponse.next();
  }

  const token = getToken(req);
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const payload = decode(token);
  if (!payload?.role) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Admin routes (owner/admin only)
  if (pathname.startsWith("/admin")) {
    const role = String(payload.role || "").toLowerCase();
    if (role !== "owner" && role !== "admin") {
      return NextResponse.redirect(new URL("/app/dashboard", req.url));
    }
    return NextResponse.next();
  }

  // Client app routes (auth required)
  if (pathname.startsWith("/app")) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
