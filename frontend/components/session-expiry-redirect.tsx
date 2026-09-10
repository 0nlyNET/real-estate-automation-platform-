"use client"

import { useEffect } from "react"

/**
 * Listens for session expiry events and redirects to login after confirming
 * the session is truly expired with a backend check, preventing false positives
 * from transient network errors.
 *
 * @returns null - this is an invisible side-effect component
 */
export function SessionExpiryRedirect() {
  useEffect(() => {
    let checking = false
    let active = true
    const redirect = async () => {
      if (checking || !/^\/(app|admin)(\/|$)/.test(window.location.pathname)) return
      checking = true
      try {
        // A failed feature request may refer to provider authorization or an
        // old in-flight session. Confirm the current cookie before redirecting.
        const response = await fetch("/api/backend/auth/session", {
          credentials: "include", cache: "no-store", signal: AbortSignal.timeout(8_000),
        })
        if (active && response.status === 401) window.location.assign("/login?reason=session_expired")
      } catch {
        // Network failure is not evidence that the session expired.
      } finally {
        checking = false
      }
    }
    window.addEventListener("rta:session-expired", redirect)
    return () => { active = false; window.removeEventListener("rta:session-expired", redirect) }
  }, [])

  return null
}
