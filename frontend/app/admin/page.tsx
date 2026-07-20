"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function AdminIndexPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/admin/overview")
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="text-sm text-muted-foreground">Opening business overview…</div>
    </div>
  )
}
