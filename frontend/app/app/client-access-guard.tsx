"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { clientNavigation, isSetupPath } from "@/lib/client-navigation"
import { AppShell } from "@/components/app-shell/app-shell"
import { Button } from "@/components/ui/button"

type Access = { platformRole: string | null; serviceAccess: { allowed: boolean; billingEligible: boolean; reason: string | null } }

/**
 * Guards client workspace routes by verifying service access eligibility,
 * allowing platform operators and setup paths through while blocking suspended
 * or unpaid accounts from operational features.
 *
 * @param children - The protected route content to render when access is granted
 * @returns React component showing access check, restriction notice, or children
 */
export function ClientAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [access, setAccess] = useState<Access | null>(null)
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(true)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const verify = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const current = ++generation.current
    setChecking(true)
    setError("")
    try {
      const next = await apiFetch<Access>("/me")
      if (!next?.serviceAccess || typeof next.serviceAccess.allowed !== "boolean") throw new Error("Invalid access response")
      if (current === generation.current) setAccess(next)
    } catch {
      if (current === generation.current) setError("Workspace access could not be checked. Your sign-in has been kept; please retry.")
    } finally {
      inFlight.current = false
      if (current === generation.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void verify(), 0)
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void verify() }
    window.addEventListener("pageshow", onPageShow)
    window.addEventListener("rta:workspace-access-changed", verify)
    return () => {
      window.clearTimeout(initialCheck)
      generation.current += 1
      window.removeEventListener("pageshow", onPageShow)
      window.removeEventListener("rta:workspace-access-changed", verify)
    }
  }, [verify])

  // Setup and payment recovery stay reachable. A slow access check never
  // redirects or mounts operational page effects before authorization.
  if (isSetupPath(pathname) || (!checking && !error && (access?.platformRole || access?.serviceAccess.allowed))) return children
  const title = clientNavigation.find((item) => item.href === pathname)?.label || "Workspace"
  return (
    <AppShell>
      <div className="space-y-4" aria-busy={checking}>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {checking ? <p role="status">Checking workspace access…</p> : error ? (
          <div role="alert" className="space-y-3"><p>{error}</p><Button onClick={() => void verify()}>Try again</Button></div>
        ) : (
          <div className="space-y-3 rounded-lg border p-5">
            <h2 className="font-semibold">{access?.serviceAccess.billingEligible ? "Services suspended" : "Payment confirmation required"}</h2>
            <p className="text-sm text-muted-foreground">{access?.serviceAccess.reason || "Confirm payment to use this workspace's features."}</p>
            <div className="flex gap-2">
              <Button asChild><Link href={access?.serviceAccess.billingEligible ? "/support" : "/app/billing"}>{access?.serviceAccess.billingEligible ? "Contact support" : "Manage billing"}</Link></Button>
              <Button variant="outline" onClick={() => void verify()}>Check access again</Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
