"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api"
import { Clock3, CalendarCheck2, MessageSquare, Users } from "lucide-react"

type Breakdown = { label: string; count: number }

type Overview = {
  leadsTotal: number
  messagesTotal: number
  newLeads7d: number
  avgFirstResponseSec: number | null
  responseSamples: number
  pctContactedWithin5Min: number | null
  appointmentsSet7d: number
  stageBreakdown: Breakdown[]
  sourceBreakdown: Breakdown[]
}

type AgentMetric = {
  userId: string
  email: string
  role: string
  leadsAssigned: number
  leadsNew7d: number
  messagesSent7d: number
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "No replies yet"
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export default function ReportsPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [agents, setAgents] = useState<AgentMetric[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    Promise.all([
      apiFetch<Overview>("/stats/overview"),
      apiFetch<AgentMetric[]>("/stats/agents").catch(() => null),
    ])
      .then(([stats, agentMetrics]) => {
        if (!active) return
        setOverview(stats)
        setAgents(agentMetrics)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Reporting could not be loaded",
        )
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <PageShell
      title="Reporting"
      subtitle="Lead volume, response speed, pipeline health, and team activity."
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Reporting unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="New leads (7d)"
          value={overview?.newLeads7d}
          hint={`${overview?.leadsTotal ?? 0} total leads`}
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          title="Messages"
          value={overview?.messagesTotal}
          hint="Inbound and outbound activity"
          icon={<MessageSquare className="h-4 w-4" />}
        />
        <MetricCard
          title="Avg first response"
          value={overview ? formatDuration(overview.avgFirstResponseSec) : undefined}
          hint={`${overview?.responseSamples ?? 0} measured replies`}
          icon={<Clock3 className="h-4 w-4" />}
        />
        <MetricCard
          title="Appointments (7d)"
          value={overview?.appointmentsSet7d}
          hint={
            overview?.pctContactedWithin5Min == null
              ? "No first-contact sample yet"
              : `${overview.pctContactedWithin5Min}% contacted within 5 minutes`
          }
          icon={<CalendarCheck2 className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownCard
          title="Pipeline by stage"
          items={overview?.stageBreakdown}
          total={overview?.leadsTotal || 0}
          empty="Lead stages will appear after the first lead is captured."
        />
        <BreakdownCard
          title="Leads by source"
          items={overview?.sourceBreakdown}
          total={overview?.leadsTotal || 0}
          empty="Sources will appear after website, Facebook, or manual leads arrive."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team activity</CardTitle>
        </CardHeader>
        <CardContent>
          {agents === null ? (
            <p className="text-sm text-muted-foreground">
              Agent-level reporting is available to workspace admins on the Teams plan.
            </p>
          ) : agents.length ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-3 font-medium">Team member</th>
                    <th className="p-3 font-medium">Assigned leads</th>
                    <th className="p-3 font-medium">New leads (7d)</th>
                    <th className="p-3 font-medium">Messages sent (7d)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {agents.map((agent) => (
                    <tr key={agent.userId}>
                      <td className="p-3">
                        <div className="font-medium">{agent.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatLabel(agent.role)}
                        </div>
                      </td>
                      <td className="p-3">{agent.leadsAssigned}</td>
                      <td className="p-3">{agent.leadsNew7d}</td>
                      <td className="p-3">{agent.messagesSent7d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add team members and assign leads to compare activity.
            </p>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}

function MetricCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string
  value: string | number | undefined
  hint: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        {value === undefined ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-semibold">{value}</div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

function BreakdownCard({
  title,
  items,
  total,
  empty,
}: {
  title: string
  items: Breakdown[] | undefined
  total: number
  empty: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items === undefined ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length ? (
          items.map((item) => {
            const percentage = total ? Math.round((item.count / total) * 100) : 0
            return (
              <div key={item.label} className="space-y-1">
                <div className="flex justify-between gap-3 text-sm">
                  <span>{formatLabel(item.label)}</span>
                  <span className="text-muted-foreground">
                    {item.count} ({percentage}%)
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          })
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  )
}
