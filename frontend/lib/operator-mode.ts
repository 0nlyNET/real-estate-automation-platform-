export const OPERATOR_MODE_CHANGED_EVENT = "rta:operator-mode-changed"

export async function enterOperatorMode(tenantId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("/api/backend/admin/operator-mode", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      return { ok: false, error: text || `Request failed (${response.status})` }
    }
    window.dispatchEvent(new Event(OPERATOR_MODE_CHANGED_EVENT))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Request failed" }
  }
}

export async function exitOperatorMode(destination = "/admin/dashboard") {
  const response = await fetch("/api/backend/admin/operator-mode/exit", {
    method: "POST",
    credentials: "include",
  })
  window.dispatchEvent(new Event(OPERATOR_MODE_CHANGED_EVENT))
  window.location.assign(response.ok ? destination : "/login")
}
