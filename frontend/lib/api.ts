const RAW_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

export const API_BASE_URL = RAW_BASE.replace(/\/+$/, "")

export type ApiFetchOptions = RequestInit & {
  json?: any
  auth?: boolean
}

export class ApiError extends Error {
  status: number
  url: string
  detail?: string

  constructor(params: { status: number; url: string; message: string; detail?: string }) {
    super(params.message)
    this.status = params.status
    this.url = params.url
    this.detail = params.detail
  }
}

function getToken() {
  if (typeof window === "undefined") return null
  return localStorage.getItem("rta_token")
}

export async function apiFetch<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const urlPath = path.startsWith("/") ? path : `/${path}`
  const { json, auth, headers, ...rest } = options

  const token = auth ? getToken() : null

  let res: Response
  const fullUrl = `${API_BASE_URL}${urlPath}`
  try {
    res = await fetch(fullUrl, {
      ...rest,
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
      body: json ? JSON.stringify(json) : rest.body,
    })
  } catch (error) {
    throw new ApiError({
      status: 0,
      url: fullUrl,
      message: "Network/CORS error",
      detail: error instanceof Error ? error.message : undefined,
    })
  }

  const text = await res.text().catch(() => "")
  let data: any = null

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) ||
      `Request failed: ${res.status}`
    const message = Array.isArray(msg) ? msg.join(", ") : msg
    throw new ApiError({
      status: res.status,
      url: fullUrl,
      message,
      detail: typeof data === "string" ? data : undefined,
    })
  }

  return data as T
}
