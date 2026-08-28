export const API_URL = "/api/backend"

async function readResponseBody(res: Response): Promise<unknown> {
  const contentType = (res.headers.get("content-type") || "").toLowerCase()

  // Always read as text first, because res.json() will throw on empty / non-json.
  const text = await res.text()

  if (!text) return null

  // If server says it's JSON, try JSON first.
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  // Otherwise: attempt JSON, but safely fall back to text.
  const trimmed = text.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return text
    }
  }

  return text
}

function extractErrorMessage(payload: unknown): string {
  if (!payload) return "Request failed"

  if (typeof payload === "string") return payload

  if (payload instanceof Error) return payload.message

  // Nest commonly returns: { message: string | string[], error: string, statusCode: number }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>
    const msg = record.message
    if (typeof msg === "string" && msg.trim()) return msg
    if (Array.isArray(msg) && msg.length) return msg.map(String).join(", ")

    const err = record.error
    if (typeof err === "string" && err.trim()) return err

    try {
      return JSON.stringify(payload)
    } catch {
      return "Request failed"
    }
  }

  return String(payload)
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly retryAfter: string | null,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const code = (payload as Record<string, unknown>).code
  return typeof code === "string" && code.trim() ? code : null
}

export type ApiRequestInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | unknown[] | null
}

function isJsonBody(
  body: ApiRequestInit["body"],
): body is Record<string, unknown> | unknown[] {
  if (Array.isArray(body)) return true
  if (!body || typeof body !== "object") return false
  return Object.getPrototypeOf(body) === Object.prototype
}

// Callers that use the response should specify T; the default preserves legacy call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function apiFetch<T = any>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`

  const headers = new Headers(init.headers || {})
  headers.set("Accept", "application/json")

  const requestedBody = init.body
  let body: BodyInit | null | undefined

  // Plain objects and arrays are JSON. Native BodyInit values pass through unchanged.
  if (isJsonBody(requestedBody)) {
    if (!headers.has("Content-Type"))
      headers.set("Content-Type", "application/json")
    body = JSON.stringify(requestedBody)
  } else {
    body = requestedBody as BodyInit | null | undefined
  }

  const res = await fetch(url, {
    ...init,
    headers,
    body,
    credentials: "include",
  })

  const payload = await readResponseBody(res)

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("rta:session-expired"))
    }
    const msg = extractErrorMessage(payload)
    throw new ApiError(
      msg,
      res.status,
      extractErrorCode(payload),
      res.headers.get("retry-after"),
    )
  }

  return payload as T
}
