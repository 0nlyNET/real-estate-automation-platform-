import { NextRequest, NextResponse } from "next/server"

type VerifiedSession = {
  userId: string
  isPlatformAdmin: boolean
  platformRole: "super_admin" | "staff" | null
}

async function readVerifiedSession(req: NextRequest): Promise<VerifiedSession | null> {
  const cookie = req.headers.get("cookie")
  if (!cookie) return null

  const backend = String(process.env.BACKEND_API_URL || "http://localhost:4000").replace(/\/+$/, "")

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${backend}/me`, {
        headers: {
          accept: "application/json",
          cookie,
          "x-forwarded-host": req.nextUrl.host,
          "x-forwarded-proto": req.nextUrl.protocol.replace(":", ""),
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      })
      // Authentication failures are authoritative. Transient backend failures
      // get one bounded retry so a warm-up does not eject a valid user.
      if (response.status === 401 || response.status === 403) return null
      if (!response.ok) continue

      const session = (await response.json()) as Partial<VerifiedSession>
      if (typeof session.userId !== "string" || !session.userId) return null
      return {
        userId: session.userId,
        isPlatformAdmin: session.isPlatformAdmin === true,
        platformRole:
          session.platformRole === "super_admin" || session.platformRole === "staff"
            ? session.platformRole
            : null,
      }
    } catch {
      // Retry once on a timeout/network failure, then fail closed below.
    }
  }
  return null
}

export async function proxy(req: NextRequest) {
  const session = await readVerifiedSession(req)
  if (!session) return NextResponse.redirect(new URL("/login", req.url))

  if (req.nextUrl.pathname.startsWith("/admin") && !session.platformRole) {
    return NextResponse.redirect(new URL("/app/dashboard", req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
}
