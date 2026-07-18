import { NextRequest, NextResponse } from "next/server"

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1]
    if (!payload) return null
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

export function proxy(req: NextRequest) {
  const token = req.cookies.get("rtai_token")?.value
  const payload = token ? decodePayload(token) : null
  if (!payload) return NextResponse.redirect(new URL("/login", req.url))

  if (req.nextUrl.pathname.startsWith("/admin") && payload.platformAdmin !== true) {
    return NextResponse.redirect(new URL("/app/dashboard", req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
}
