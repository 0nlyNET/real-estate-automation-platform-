"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

export function SupportNavigationHistory() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname.startsWith("/app/") || pathname.startsWith("/admin/")) {
      try { sessionStorage.setItem("supportReturnPath", `${pathname}${window.location.search}`) } catch {}
    }
  }, [pathname])
  return null
}
