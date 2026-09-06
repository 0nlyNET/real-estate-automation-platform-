import { NextRequest, NextResponse } from "next/server"

type VerifiedSession = {
  userId: string
  platformRole: "super_admin" | "staff" | null
}

async function readVerifiedSession(req: NextRequest): Promise<VerifiedSession | null> {
  const cookie = req.headers.get("cookie")
  if (!cookie || !/(?:^|;\s*)rtai_session=[^;]+/.test(cookie)) return null
  const backend = String(process.env.BACKEND_API_URL || "http://localhost:4000").replace(/\/+$/, "")
  const options: RequestInit = {
    headers: { accept: "application/json", cookie },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  }
  let response = await fetch(`${backend}/auth/session`, options)
  // Support a staggered frontend/backend rollout. The old endpoint has the
  // same verified identity fields; only a missing new route uses this fallback.
  if (response.status === 404) response = await fetch(`${backend}/me`, options)
  // Only a rejected session is a reason to sign in again. 403, 429, 5xx,
  // malformed responses and timeouts must never masquerade as logged out.
  if (response.status === 401) return null
  if (!response.ok) throw new Error("Session verification unavailable")
  const session = (await response.json()) as Partial<VerifiedSession>
  if (!session.userId || typeof session.userId !== "string") throw new Error("Invalid session response")
  return {
    userId: session.userId,
    platformRole: session.platformRole === "super_admin" || session.platformRole === "staff" ? session.platformRole : null,
  }
}

export async function proxy(req: NextRequest) {
  let session: VerifiedSession | null
  try {
    session = await readVerifiedSession(req)
  } catch {
    // Fail closed without discarding the cookie or sending the user to login.
    return NextResponse.rewrite(new URL("/session-unavailable", req.url), {
      status: 503,
      headers: { "cache-control": "private, no-store", "retry-after": "5" },
    })
  }
  if (!session) return NextResponse.redirect(new URL("/login?reason=session_expired", req.url))
  if (req.nextUrl.pathname.startsWith("/admin") && !session.platformRole) {
    return NextResponse.redirect(new URL("/app/dashboard", req.url))
  }
  // ClientAccessGuard explains restrictions at the selected URL. All
  // operational backend endpoints still enforce paid workspace access.
  const response = NextResponse.next()
  response.headers.set("cache-control", "private, no-store")
  return response
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
}
