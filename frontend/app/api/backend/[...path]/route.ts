import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const backend = String(process.env.BACKEND_API_URL || "http://localhost:4000").replace(/\/$/, "")
  const target = new URL(`${backend}/${path.map(encodeURIComponent).join("/")}`)
  target.search = request.nextUrl.search

  const headers = new Headers()
  for (const name of ["accept", "content-type", "cookie", "idempotency-key"]) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set("x-forwarded-host", request.nextUrl.host)
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""))

  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.arrayBuffer()
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  })
  const responseHeaders = new Headers()
  for (const name of ["content-type", "location", "retry-after"]) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const cookies = getSetCookie ? getSetCookie.call(upstream.headers) : []
  for (const cookie of cookies) responseHeaders.append("set-cookie", cookie)
  if (!cookies.length) {
    const cookie = upstream.headers.get("set-cookie")
    if (cookie) responseHeaders.append("set-cookie", cookie)
  }
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
