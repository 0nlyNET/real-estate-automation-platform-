"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  IMPERSONATION_TOKEN_KEY,
  IMPERSONATION_USER_KEY,
} from '@/lib/impersonation'

function clearAuthCookie() {
  document.cookie = "rtai_token=; Path=/; Max-Age=0; SameSite=Lax"
}

export default function LogoutPage() {
  const router = useRouter()

  useEffect(() => {
    try {
      localStorage.removeItem("rta_token")
      localStorage.removeItem("rta_user")
      localStorage.removeItem("rta_pending_email")
      sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY)
      sessionStorage.removeItem(IMPERSONATION_USER_KEY)
    } catch {}

    try {
      clearAuthCookie()
    } catch {}

    router.replace("/login")
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-sm text-muted-foreground">Signing you out...</div>
    </div>
  )
}
