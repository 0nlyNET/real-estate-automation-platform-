const RAW_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

export const API_BASE_URL = RAW_BASE.replace(/\/+$/, "")

export type ApiFetchOptions = RequestInit & {
  json?: any
  auth?: boolean
}

function getToken() {
  if (typeof window === "undefined") return null
  return localStorage.getItem("rta_token")
}

export async function apiFetch<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const urlPath = path.startsWith("/") ? path : `/${path}`
  const { json, auth, headers, ...rest } = options

  const token = auth ? getToken() : null

  const res = await fetch(`${API_BASE_URL}${urlPath}`, {
    ...rest,
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: json ? JSON.stringify(json) : rest.body,
  })

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
    throw new Error(Array.isArray(msg) ? msg.join(", ") : msg)
  }

  return data as T
}
