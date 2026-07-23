"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function AdminIndexPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/admin/overview")
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-sm text-muted-foreground">Opening admin operating center…</div>
    </div>
  )
}
