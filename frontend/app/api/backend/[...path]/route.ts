import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
const MAX_PROXY_BODY_BYTES = 2_000_000

async function boundedRequestBody(request: NextRequest) {
  if (["GET", "HEAD"].includes(request.method) || !request.body) return undefined
  const declaredLength = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXY_BODY_BYTES) {
    throw new RangeError("Request body is too large")
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_PROXY_BODY_BYTES) {
      await reader.cancel("Request body is too large")
      throw new RangeError("Request body is too large")
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const backend = String(process.env.BACKEND_API_URL || "http://localhost:4000").replace(/\/$/, "")
  const target = new URL(`${backend}/${path.map(encodeURIComponent).join("/")}`)
  target.search = request.nextUrl.search

  const headers = new Headers()
  for (const name of ["accept", "content-type", "cookie", "idempotency-key", "origin"]) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set("x-forwarded-host", request.nextUrl.host)
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""))

  let body: Uint8Array<ArrayBuffer> | undefined
  try {
    body = await boundedRequestBody(request)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return NextResponse.json(
      { statusCode: 413, message: "Request body is too large" },
      {
        status: 413,
        headers: {
          "cache-control": "private, no-store, max-age=0",
          pragma: "no-cache",
          expires: "0",
        },
      },
    )
  }
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
  // API responses can contain tenant, authentication, billing, or provider
  // state. Never let a browser, CDN, or shared proxy retain them, including
  // errors and unauthenticated responses.
  responseHeaders.set("cache-control", "private, no-store, max-age=0")
  responseHeaders.set("pragma", "no-cache")
  responseHeaders.set("expires", "0")
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
