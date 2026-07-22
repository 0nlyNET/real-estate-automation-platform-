"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { fetchMe } from "@/lib/me"

/**
 * Defense in depth for browser history/bfcache: middleware protects a request,
 * but a previously rendered admin page can otherwise be restored without one.
 * Do not mount admin UI (or its data-fetching effects) until the server confirms
 * a platform role, and re-check whenever the page is restored from history.
 */
export function AdminAccessGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)

  const verify = useCallback(async () => {
    const session = await fetchMe()
    if (session?.platformRole === "super_admin" || session?.platformRole === "staff") {
      setAllowed(true)
      return
    }
    setAllowed(false)
    router.replace(session ? "/app/dashboard" : "/login")
  }, [router])

  useEffect(() => {
    void verify()
    const onPageShow = () => void verify()
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [verify])

  if (!allowed) {
    return <div className="min-h-screen bg-background" aria-label="Checking workspace access" />
  }
  return children
}
