"use client"

import { useEffect } from "react"

export function SessionExpiryRedirect() {
  useEffect(() => {
    const redirect = () => {
      if (window.location.pathname === "/login") return
      window.location.assign("/login?reason=session_expired")
    }
    window.addEventListener("rta:session-expired", redirect)
    return () => window.removeEventListener("rta:session-expired", redirect)
  }, [])

  return null
}
