"use client"

import { Button } from "@/components/ui/button"

const ADMIN_SNAPSHOT_KEY = "rta_admin_snapshot_v1"

function setAuthCookie(token: string) {
  const maxAge = 60 * 60 * 24 * 7
  document.cookie = `rtai_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
}

export function ReturnToAdminButton() {
  const raw = typeof window !== "undefined" ? localStorage.getItem(ADMIN_SNAPSHOT_KEY) : null
  if (!raw) return null

  function restore() {
    try {
      if (!raw) return
      const snap = JSON.parse(raw)
      if (!snap?.token || !snap?.user) return

      localStorage.setItem("rta_token", snap.token)
      localStorage.setItem("rta_user", typeof snap.user === "string" ? snap.user : JSON.stringify(snap.user))
      setAuthCookie(snap.token)

      // optional: keep snapshot so you can go back/forth, or remove it
      // localStorage.removeItem(ADMIN_SNAPSHOT_KEY)

      window.location.href = "/admin/dashboard"
    } catch {
      // if snapshot corrupted, remove it
      localStorage.removeItem(ADMIN_SNAPSHOT_KEY)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={restore}>
      Return to admin
    </Button>
  )
}
