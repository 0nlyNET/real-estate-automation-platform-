"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"
import { fetchMePlan, formatDate, type MePlan } from "@/lib/plan"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"
import { ImpersonationBanner } from './impersonation-banner'
import { CalendarDays, Inbox, LayoutDashboard, Users } from "lucide-react"

const mobileNavItems = [
  { label: "Today", href: "/app/dashboard", icon: LayoutDashboard },
  { label: "Leads", href: "/app/leads", icon: Users },
  { label: "Conversations", href: "/app/inbox", icon: Inbox },
  { label: "Appointments", href: "/app/appointments", icon: CalendarDays },
]

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

  const serviceState = plan?.serviceState?.state
  const suspended = serviceState === "suspended"
  const gracePeriod = serviceState === "grace_period"
  const paymentOverdue = serviceState === "payment_overdue" || plan?.status === "past_due"
  const serviceAttention = suspended || gracePeriod || paymentOverdue
  const canceling = Boolean(plan?.cancelAtPeriodEnd && plan?.currentPeriodEnd)
  const billingRelated =
    plan?.serviceSuspensionSource === "billing" ||
    ["past_due", "unpaid"].includes(plan?.status || "")

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden w-60 shrink-0 border-r md:block"><Sidebar /></aside>
      <div className="flex w-full flex-col">
        <Topbar />
        <nav className="flex overflow-x-auto border-b bg-background px-2 py-1 md:hidden" aria-label="Client navigation">
          {mobileNavItems.map(({ label, href, icon: Icon }) => (
            <Link key={href} href={href} className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <Icon className="h-4 w-4" />{label}
            </Link>
          ))}
        </nav>
        <ImpersonationBanner />

        {(serviceAttention || canceling) && (
          <div className={`border-b px-4 py-3 ${suspended ? "border-red-500/30 bg-red-500/10" : "bg-muted/50"}`}>
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
              <div className="text-sm">
                {suspended ? (
                  <div>
                    <div className="font-medium">Services suspended</div>
                    <div className="text-muted-foreground">
                      {plan?.serviceSuspensionReason || "Automated follow-up is stopped. Your leads, conversations, appointments, and history remain available."}
                    </div>
                  </div>
                ) : gracePeriod ? (
                  <div>
                    <div className="font-medium">Payment overdue — grace period</div>
                    <div className="text-muted-foreground">
                      Update the payment method before {formatDate(plan?.serviceState?.graceEndsAt) || "the grace period ends"} to keep service active.
                    </div>
                  </div>
                ) : paymentOverdue ? (
                  <div>
                    <div className="font-medium">Payment overdue</div>
                    <div className="text-muted-foreground">
                      Automated services are blocked until payment is confirmed.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="font-medium">Subscription will end</div>
                    <div className="text-muted-foreground">
                      Your service ends on {formatDate(plan?.currentPeriodEnd) || "your period end date"}.
                    </div>
                  </div>
                )}
              </div>

              <Link href={suspended && !billingRelated ? "/support" : "/app/billing"}>
                <Button size="sm" variant={serviceAttention ? "default" : "outline"}>
                  {suspended && !billingRelated ? "Contact support" : "Manage billing"}
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
