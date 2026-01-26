"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function LogoutPage() {
  const router = useRouter()

  useEffect(() => {
    try {
      localStorage.removeItem("rta_token")
    } catch {}

    router.replace("/login")
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-sm text-muted-foreground">Signing you out...</div>
    </div>
  )
}
