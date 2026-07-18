const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("rta_token");
  } catch {
    return null;
  }
}

async function readResponseBody(res: Response): Promise<any> {
  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  // Always read as text first, because res.json() will throw on empty / non-json.
  const text = await res.text();

  if (!text) return null;

  // If server says it's JSON, try JSON first.
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // Otherwise: attempt JSON, but safely fall back to text.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }

  return text;
}

function extractErrorMessage(payload: any): string {
  if (!payload) return "Request failed";

  if (typeof payload === "string") return payload;

  if (payload instanceof Error) return payload.message;

  // Nest commonly returns: { message: string | string[], error: string, statusCode: number }
  if (typeof payload === "object") {
    const msg = (payload as any).message;
    if (typeof msg === "string" && msg.trim()) return msg;
    if (Array.isArray(msg) && msg.length) return msg.map(String).join(", ");

    const err = (payload as any).error;
    if (typeof err === "string" && err.trim()) return err;

    try {
      return JSON.stringify(payload);
    } catch {
      return "Request failed";
    }
  }

  return String(payload);
}

export type ApiRequestInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | unknown[] | null
}

export async function apiFetch<T = any>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");

  // Attach JWT unless caller explicitly set Authorization already.
  if (!headers.has("Authorization")) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let body = init.body as any;

  // If someone passed a plain object as body, stringify it safely.
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
  const isURLSearchParams = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;

  if (body && typeof body === "object" && !isFormData && !isBlob && !isURLSearchParams) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const res = await fetch(url, {
    ...init,
    headers,
    body,
  });

  const payload = await readResponseBody(res);

  if (!res.ok) {
    const msg = extractErrorMessage(payload);
    throw new Error(msg);
  }

  return payload as T;
}
