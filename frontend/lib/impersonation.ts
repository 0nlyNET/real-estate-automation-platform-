export const AUTH_CHANGED_EVENT = "rta:auth-changed"

export async function exitImpersonation(destination = "/admin/dashboard") {
  const response = await fetch("/api/backend/auth/stop-impersonation", {
    method: "POST",
    credentials: "include",
  })
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT))
  window.location.assign(response.ok ? destination : "/login")
}
