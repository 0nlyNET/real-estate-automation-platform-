"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"

export function SupportNavigationHistory() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()

  useEffect(() => {
    if (pathname.startsWith("/app/") || pathname.startsWith("/admin/")) {
      const query = search ? `?${search}` : ""
      try { sessionStorage.setItem("supportReturnPath", `${pathname}${query}`) } catch {}
    }
  }, [pathname, search])
  return null
}
