"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"
import { Users, MessageSquare, Inbox } from "lucide-react"

type StatsOverview = {
  leadsTotal: number
  messagesTotal: number
  avgFirstResponseSec: number | null
  pctContactedWithin5Min: number | null
  appointmentsSet7d: number
}

type ThreadsResponse = {
  items?: Array<any>
}

function KpiCard({
  title,
  value,
  hint,
  icon,
  footer,
}: {
  title: string
  value: React.ReactNode
  hint: string
  icon: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-semibold leading-none">{value}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {footer ? <div className="pt-2">{footer}</div> : null}
      </CardContent>
    </Card>
  )
}

export function DashboardKpis() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<StatsOverview>({
    leadsTotal: 0,
    messagesTotal: 0,
    avgFirstResponseSec: null,
    pctContactedWithin5Min: null,
    appointmentsSet7d: 0,
  })

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        const st = await apiFetch<StatsOverview>("/stats/overview").catch(() => ({
          leadsTotal: 0,
          messagesTotal: 0,
          avgFirstResponseSec: null,
          pctContactedWithin5Min: null,
          appointmentsSet7d: 0,
        }))

        // Light health-check so dashboard doesn't break if inbox endpoint changes.
        await apiFetch<ThreadsResponse>("/messaging/threads?take=1&skip=0").catch(() => ({ items: [] }))

        if (!alive) return
        setStats(
          st || {
            leadsTotal: 0,
            messagesTotal: 0,
            avgFirstResponseSec: null,
            pctContactedWithin5Min: null,
            appointmentsSet7d: 0,
          }
        )
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <KpiCard
        title="Average lead reply time"
        value={
          loading ? (
            <Skeleton className="h-9 w-24" />
          ) : stats.avgFirstResponseSec == null ? (
            "—"
          ) : (
            `${Math.round(stats.avgFirstResponseSec / 60)}m`
          )
        }
        hint="Average lead reply time after first provider-accepted outreach."
        icon={<Inbox className="h-4 w-4" />}
        footer={
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href="/app/inbox">Open inbox</Link>
          </Button>
        }
      />

      <KpiCard
        title="Provider accepted < 5 min"
        value={
          loading ? (
            <Skeleton className="h-9 w-20" />
          ) : stats.pctContactedWithin5Min == null ? (
            "—"
          ) : (
            `${stats.pctContactedWithin5Min}%`
          )
        }
        hint="Initial outreach accepted by a provider within five minutes; not delivery or reading."
        icon={<MessageSquare className="h-4 w-4" />}
        footer={
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href="/app/automations">Automation health</Link>
          </Button>
        }
      />

      <KpiCard
        title="Appointments (7d)"
        value={loading ? <Skeleton className="h-9 w-16" /> : stats.appointmentsSet7d}
        hint="Leads moved to Appointment Set in last 7 days."
        icon={<Users className="h-4 w-4" />}
        footer={
          <div className="flex gap-2">
            <Button asChild size="sm" className="h-8">
              <Link href="/app/leads">View leads</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8">
              <Link href="/app/integrations">Connect sources</Link>
            </Button>
          </div>
        }
      />
    </div>
  )
}
