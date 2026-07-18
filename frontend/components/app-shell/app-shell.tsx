"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"
import { fetchMePlan, formatDate, type MePlan } from "@/lib/plan"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"
import { ImpersonationBanner } from './impersonation-banner'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<MePlan | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      const p = await fetchMePlan()
      if (!mounted) return
      setPlan(p)
    }

    load()

    // re-check occasionally so UI stays truthful
    const interval = setInterval(load, 30_000)
    apiFetch("/presence/heartbeat", { method: "POST", body: { status: "online" } }).catch(() => undefined)
    const presenceInterval = setInterval(() => {
      apiFetch("/presence/heartbeat", { method: "POST", body: { status: "online" } }).catch(() => undefined)
    }, 60_000)

    return () => {
      mounted = false
      clearInterval(interval)
      clearInterval(presenceInterval)
    }
  }, [])

  const pastDue = plan?.status === "past_due"
  const canceling = Boolean(plan?.cancelAtPeriodEnd && plan?.currentPeriodEnd)

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex w-full flex-col">
        <Topbar />
        <ImpersonationBanner />

        {(pastDue || canceling) && (
          <div className="border-b bg-muted/50 px-4 py-3">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
              <div className="text-sm">
                {pastDue ? (
                  <div>
                    <div className="font-medium">Payment failed</div>
                    <div className="text-muted-foreground">
                      Your subscription is past due. Update your payment method to avoid losing access.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="font-medium">Subscription will end</div>
                    <div className="text-muted-foreground">
                      Your plan cancels on {formatDate(plan?.currentPeriodEnd) || "your period end date"}.
                    </div>
                  </div>
                )}
              </div>

              <Link href="/app/billing">
                <Button size="sm" variant={pastDue ? "default" : "outline"}>
                  Manage billing
                </Button>
              </Link>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
