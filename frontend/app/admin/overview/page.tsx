"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type BusinessOverview = {
  generatedAt: string
  clients: {
    total: number
    active: number
    newThisMonth: number
    onboarding: number
    incompleteOnboarding: number
    pastDue: number
    canceled: number
    changeVsPreviousMonth: number | null
  }
  leads: {
    open: number
    applicationsOpen: number
    applicationsNew: number
    applicationsThisMonth: number
    conversionRate: number | null
    changeVsPreviousMonth: number | null
  }
  billing: {
    available: boolean
    currency: string | null
    monthlyRecurringRevenue: number | null
    collectedThisMonth: number | null
    collectedThisYear: number | null
    outstandingPayments: number
    failedPayments: number
    canceledSubscriptions: number
    note: string | null
  }
  operations: {
    openTasks: number
    overdueTasks: number
    highPriorityTasks: number
    openSupport: number
    urgentSupport: number
    integrationsRequiringAttention: number
  }
}

type SystemHealth = {
  totalMessages24h: number
  failedMessages24h: number
  dbConnected: boolean
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The business overview could not be loaded."
}

function money(cents: number | null, currency: string | null) {
  if (cents === null || !currency) return "Unavailable"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function comparison(value: number | null, label: string) {
  if (value === null) return "Not enough history for a reliable comparison"
  if (value === 0) return `No change ${label}`
  return `${value > 0 ? "+" : ""}${value}% ${label}`
}

export default function AdminOverviewPage() {
  const [overview, setOverview] = useState<BusinessOverview | null>(null)
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [business, system] = await Promise.all([
          apiFetch<BusinessOverview>("/admin/business-overview"),
          apiFetch<SystemHealth>("/admin/system-health"),
        ])
        if (!active) return
        setOverview(business)
        setHealth(system)
      } catch (loadError: unknown) {
        if (active) setError(errorMessage(loadError))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading business overview…</div>

  const attentionItems = overview
    ? [
        {
          label: "New contact forms awaiting response",
          value: overview.leads.applicationsNew,
          href: "/admin/dashboard#prospect-applications",
          urgent: overview.leads.applicationsNew > 0,
        },
        {
          label: "Clients with incomplete onboarding",
          value: overview.clients.incompleteOnboarding,
          href: "/admin/dashboard#clients",
          urgent: overview.clients.incompleteOnboarding > 0,
        },
        {
          label: "Overdue operational tasks",
          value: overview.operations.overdueTasks,
          href: "/admin/dashboard#operations-queue",
          urgent: overview.operations.overdueTasks > 0,
        },
        {
          label: "High-priority support requests",
          value: overview.operations.urgentSupport,
          href: "/admin/dashboard#support-tickets",
          urgent: overview.operations.urgentSupport > 0,
        },
        {
          label: "Payments requiring attention",
          value: overview.billing.outstandingPayments,
          href: "/admin/dashboard#clients",
          urgent: overview.billing.outstandingPayments > 0,
        },
        {
          label: "Integrations or workflows requiring attention",
          value: overview.operations.integrationsRequiringAttention,
          href: "/admin/dashboard#operations-queue",
          urgent: overview.operations.integrationsRequiringAttention > 0,
        },
      ]
    : []

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Operating center</p>
          <h1 className="text-3xl font-semibold tracking-tight">Business overview</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            A verified snapshot of clients, leads, billing, onboarding, support, and delivery risks.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/dashboard">Open operations workspace</Link>
        </Button>
      </div>

      {error ? (
        <Card className="border-red-500/40">
          <CardContent className="pt-6 text-sm text-red-600">{error}</CardContent>
        </Card>
      ) : null}

      {overview ? (
        <>
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">What needs attention</h2>
              <p className="text-sm text-muted-foreground">Work the exceptions first, then review normal activity.</p>
            </div>
            <Card>
              <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
                {attentionItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div>
                      <div className="font-medium">{item.label}</div>
                      <div className="text-xs text-muted-foreground">Open the related operating records</div>
                    </div>
                    <div
                      className={`rounded-full px-3 py-1 text-sm font-semibold ${
                        item.urgent ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-700"
                      }`}
                    >
                      {item.value}
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Clients and demand</h2>
              <p className="text-sm text-muted-foreground">The current client base and new-business pipeline.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="Active clients" value={overview.clients.active} detail={`${overview.clients.total} total workspaces`} />
              <MetricCard
                title="New clients this month"
                value={overview.clients.newThisMonth}
                detail={comparison(overview.clients.changeVsPreviousMonth, "versus last month")}
              />
              <MetricCard title="Open prospects" value={overview.leads.applicationsOpen} detail={`${overview.leads.applicationsThisMonth} submitted this month`} />
              <MetricCard
                title="Lead conversion"
                value={overview.leads.conversionRate === null ? "Unavailable" : `${overview.leads.conversionRate}%`}
                detail={comparison(overview.leads.changeVsPreviousMonth, "application volume")}
              />
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Billing and revenue</h2>
              <p className="text-sm text-muted-foreground">Stripe-verified totals only. No estimated production revenue is displayed.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                title="Monthly recurring revenue"
                value={money(overview.billing.monthlyRecurringRevenue, overview.billing.currency)}
                detail={overview.billing.available ? "Normalized from active Stripe subscriptions" : overview.billing.note || "Unavailable"}
              />
              <MetricCard
                title="Collected this month"
                value={money(overview.billing.collectedThisMonth, overview.billing.currency)}
                detail="Paid Stripe invoices"
              />
              <MetricCard
                title="Collected this year"
                value={money(overview.billing.collectedThisYear, overview.billing.currency)}
                detail="Paid Stripe invoices"
              />
              <MetricCard
                title="Billing risk"
                value={overview.billing.outstandingPayments}
                detail={`${overview.billing.failedPayments} clients have a recorded payment failure`}
              />
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Delivery and system health</h2>
              <p className="text-sm text-muted-foreground">Operational workload and communication reliability.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="Open tasks" value={overview.operations.openTasks} detail={`${overview.operations.highPriorityTasks} high or critical`} />
              <MetricCard title="Open support" value={overview.operations.openSupport} detail={`${overview.operations.urgentSupport} high or urgent`} />
              <MetricCard title="Messages in 24 hours" value={health?.totalMessages24h ?? "Unavailable"} detail={`${health?.failedMessages24h ?? 0} failed`} />
              <MetricCard title="Database" value={health?.dbConnected ? "Connected" : "Attention required"} detail="Live application health check" />
            </div>
          </section>

          <div className="text-xs text-muted-foreground">
            Snapshot generated {new Date(overview.generatedAt).toLocaleString()}. Revenue can be unavailable while all client and operational counts remain current.
          </div>
        </>
      ) : null}
    </div>
  )
}

function MetricCard({
  title,
  value,
  detail,
}: {
  title: string
  value: string | number
  detail: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}
