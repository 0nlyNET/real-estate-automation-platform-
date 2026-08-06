"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { fetchMe, type Me } from "@/lib/me"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const AdminSessionContext = createContext<Me | null>(null)

export function useAdminSession() {
  const session = useContext(AdminSessionContext)
  if (!session) throw new Error("Admin session is not available")
  return session
}

/**
 * Defense in depth for browser history/bfcache: middleware protects a request,
 * but a previously rendered admin page can otherwise be restored without one.
 * Do not mount admin UI (or its data-fetching effects) until the server confirms
 * a platform role, and re-check whenever the page is restored from history.
 */
export function AdminAccessGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [session, setSession] = useState<Me | null>(null)
  const [checking, setChecking] = useState(true)
  const [failed, setFailed] = useState(false)

  const verify = useCallback(async () => {
    const session = await fetchMe()
    if (session?.platformRole === "super_admin" || session?.platformRole === "staff") {
      setSession(session)
      setChecking(false)
      return
    }
    setSession(null)
    setChecking(false)
    if (session) router.replace("/app/dashboard")
    else setFailed(true)
  }, [router])

  const retry = useCallback(() => {
    setChecking(true)
    setFailed(false)
    void verify()
  }, [verify])

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void verify(), 0)
    const onPageShow = () => void verify()
    window.addEventListener("pageshow", onPageShow)
    return () => {
      window.clearTimeout(initialCheck)
      window.removeEventListener("pageshow", onPageShow)
    }
  }, [verify])

  if (checking) {
    return (
      <div className="flex min-h-screen bg-background" aria-label="Checking workspace access">
        <div className="hidden w-60 border-r p-5 lg:block">
          <Skeleton className="h-8 w-36" />
          <div className="mt-10 space-y-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-6 h-48 w-full" />
        </div>
      </div>
    )
  }

  if (failed || !session) {
    return (
      <div
        className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center"
        role="alert"
      >
        <h1 className="text-xl font-semibold">Admin access unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your session could not be verified. Sign in again or retry the access check.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
          <Button onClick={() => router.replace("/login")}>Sign in</Button>
        </div>
      </div>
    )
  }

  return <AdminSessionContext.Provider value={session}>{children}</AdminSessionContext.Provider>
}
