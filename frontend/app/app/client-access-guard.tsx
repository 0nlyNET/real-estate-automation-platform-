"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { clientNavigation, isSetupPath } from "@/lib/client-navigation"
import { AppShell } from "@/components/app-shell/app-shell"
import { Button } from "@/components/ui/button"
import type { OperatorMode } from "@/lib/me"

type Access = {
  platformRole: string | null
  serviceAccess: { allowed: boolean; billingEligible: boolean; reason: string | null }
  operatorMode: OperatorMode | null
  operatorTenantRequired: boolean
  impersonated: boolean
}

export function ClientAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [access, setAccess] = useState<Access | null>(null)
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(true)
  const generation = useRef(0)
  const abortController = useRef<AbortController | null>(null)
  const verify = useCallback(async (background = false) => {
    // Request ownership: only one active check per generation. If a check is
    // already in flight for the current generation, do not start a duplicate.
    if (abortController.current) return
    const current = ++generation.current
    const controller = new AbortController()
    abortController.current = controller
    // A background re-verification (triggered by rta:workspace-access-changed
    // after a data fetch was denied) must never tear down the UI. Unmounting
    // children while they handle the denial unmounts their error state and
    // remounts them into a refetch, which loops forever on a persistently
    // denied tenant. Only the initial check gates rendering.
    if (!background) {
      setChecking(true)
      setError("")
    }
    try {
      const next = await apiFetch<Access>("/me", { signal: controller.signal })
      if (!next?.serviceAccess || typeof next.serviceAccess.allowed !== "boolean") throw new Error("Invalid access response")
      // Only the current request may update access state.
      if (current === generation.current) setAccess(next)
    } catch (err) {
      // Aborted requests are expected on cleanup; do not show an error for them.
      // Only the current request may set the error state.
      if (controller.signal.aborted) return
      // A background refresh must not wipe the UI with an access error; the
      // page that triggered the refresh already surfaces its own denial.
      if (current === generation.current && !background) setError("Workspace access could not be checked. Your sign-in has been kept; please retry.")
    } finally {
      // Only the current request may clear the in-flight flag and loading state.
      // A stale request finishing after cleanup must not touch state owned by
      // a newer check (or by no check, if unmounted).
      if (current === generation.current) {
        abortController.current = null
        setChecking(false)
      }
    }
  }, [])

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void verify(false), 0)
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void verify(false) }
    // Denied data fetches refresh access in the background without unmounting
    // the page; the page itself renders the denial state (see verify()).
    const onAccessChanged = () => void verify(true)
    window.addEventListener("pageshow", onPageShow)
    window.addEventListener("rta:workspace-access-changed", onAccessChanged)
    return () => {
      window.clearTimeout(initialCheck)
      // Invalidate the old request: increment generation so a stale completion
      // cannot update state, and abort the fetch so it does not hang.
      generation.current += 1
      abortController.current?.abort()
      abortController.current = null
      window.removeEventListener("pageshow", onPageShow)
      window.removeEventListener("rta:workspace-access-changed", onAccessChanged)
    }
  }, [verify])

  // Fail closed: a platform operator without an explicitly selected tenant must
  // never see tenant UI. They must pick a client workspace from Admin first.
  // No implicit tenant fallback, no silent writes to the wrong workspace.
  if (!checking && !error && access?.operatorTenantRequired) {
    return (
      <AppShell>
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">Select a client workspace</h1>
          <div className="space-y-3 rounded-lg border p-5">
            <p className="text-sm text-muted-foreground">
              You are signed in as a platform operator. Tenant pages require an explicitly
              selected client workspace — RealtyTechAI will not guess which client you mean.
            </p>
            <div className="flex gap-2">
              <Button asChild><Link href="/admin/dashboard">Open Admin — choose a client</Link></Button>
              <Button variant="outline" onClick={() => void verify()}>Check again</Button>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  // Operators in explicit operator mode (or impersonating) see the tenant UI
  // for the selected tenant, with a persistent banner identifying the context.
  const explicitTenantContext = Boolean(access?.operatorMode?.tenantId || access?.impersonated)

  // Setup and payment recovery stay reachable. A slow access check never
  // redirects or mounts operational page effects before authorization.
  // Note: platformRole alone no longer grants tenant UI — operators need
  // explicitTenantContext (operator mode or impersonation).
  if (isSetupPath(pathname) || (!checking && !error && (explicitTenantContext || (!access?.platformRole && access?.serviceAccess.allowed)))) return children
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
