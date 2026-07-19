"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api"

type Breakdown = { label: string; count: number }
type MessageMetrics = { created: number; attempted: number; providerAccepted: number; sent: number; delivered: number; failed: number; skipped: number; canceled: number }
type Overview = {
  leadsTotal: number; leadsCreated: number; messageMetrics: MessageMetrics; replies: number; optOuts: number; assignments: number
  avgInitialOutreachSec: number | null; initialOutreachSamples: number; avgFirstResponseSec: number | null; responseSamples: number
  pctContactedWithin5Min: number | null; currentAppointments: number; appointmentSetEvents: number; verifiedBookings: null
  stageBreakdown: Breakdown[]; sourceBreakdown: Breakdown[]
  reporting: { from: string; to: string; timeZone: string; dataSources: string[]; statusDefinitions: Record<string, string>; limitations: string[] }
}
type AgentMetric = { userId: string; email: string; role: string; leadsAssigned: number; leadsNew7d: number; messagesProviderAccepted7d: number }

function duration(seconds: number | null) {
  if (seconds == null) return "Unavailable"
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}
function label(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }

export default function ReportsPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [agents, setAgents] = useState<AgentMetric[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    const to = new Date()
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
    const query = `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
    void Promise.all([
      apiFetch<Overview>(`/stats/overview${query}`),
      apiFetch<AgentMetric[]>("/stats/agents").catch(() => null),
    ]).then(([report, team]) => { setOverview(report); setAgents(team) })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Reporting could not be loaded"))
  }, [])

  const metrics = overview?.messageMetrics
  return <PageShell title="Reporting" subtitle="Auditable lead, outreach, reply, and pipeline activity for the last seven days.">
    {error ? <Alert variant="destructive"><AlertTitle>Reporting unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

    <Card><CardContent className="grid gap-2 pt-6 text-sm md:grid-cols-2">
      <div><span className="font-medium">Date range:</span> {overview ? `${new Date(overview.reporting.from).toLocaleString()} – ${new Date(overview.reporting.to).toLocaleString()}` : "Loading…"}</div>
      <div><span className="font-medium">Workspace time zone:</span> {overview?.reporting.timeZone || "Loading…"}</div>
      <div className="md:col-span-2"><span className="font-medium">Sources:</span> {overview?.reporting.dataSources.join(", ") || "Loading…"}</div>
    </CardContent></Card>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Leads created" value={overview?.leadsCreated} hint={`${overview?.leadsTotal ?? 0} current total`} />
      <Metric title="Provider-accepted outreach" value={metrics?.providerAccepted} hint="Provider acceptance is not delivery" />
      <Metric title="Delivered SMS" value={metrics?.delivered} hint="Only confirmed delivery callbacks" />
      <Metric title="Appointment Set movements" value={overview?.appointmentSetEvents} hint={`${overview?.currentAppointments ?? 0} currently marked Appointment Set`} />
    </div>

    <Card><CardHeader><CardTitle>Outbound message status</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics ? Object.entries(metrics).map(([key, value]) => <div key={key} className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{label(key)}</div><div className="text-2xl font-semibold">{value}</div></div>) : Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Opted out</div><div className="text-2xl font-semibold">{overview?.optOuts ?? "—"}</div></div>
      <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Lead replies</div><div className="text-2xl font-semibold">{overview?.replies ?? "—"}</div></div>
    </CardContent></Card>

    <div className="grid gap-4 lg:grid-cols-3">
      <Metric title="Average initial outreach time" value={overview ? duration(overview.avgInitialOutreachSec) : undefined} hint={`${overview?.initialOutreachSamples ?? 0} provider-accepted samples`} />
      <Metric title="Initial outreach accepted within 5 minutes" value={overview?.pctContactedWithin5Min == null ? (overview ? "Unavailable" : undefined) : `${overview.pctContactedWithin5Min}%`} hint="Measures provider API acceptance, not receipt or reading" />
      <Metric title="Average lead reply time after first outreach" value={overview ? duration(overview.avgFirstResponseSec) : undefined} hint={`${overview?.responseSamples ?? 0} measured replies`} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2"><Breakdown title="Current pipeline by stage" items={overview?.stageBreakdown} total={overview?.leadsTotal || 0} /><Breakdown title="Leads created by source in period" items={overview?.sourceBreakdown} total={overview?.leadsCreated || 0} /></div>

    <Card><CardHeader><CardTitle>Status definitions and limitations</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      {overview ? Object.entries(overview.reporting.statusDefinitions).map(([key, text]) => <p key={key}><span className="font-medium">{label(key)}:</span> {text}</p>) : <Skeleton className="h-24" />}
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{overview?.reporting.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Team activity</CardTitle></CardHeader><CardContent>
      {agents === null ? <p className="text-sm text-muted-foreground">Agent-level reporting is available to workspace admins on the Teams plan.</p> : agents.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Team member</th><th className="p-3">Assigned leads</th><th className="p-3">New leads (7d)</th><th className="p-3">Provider accepted (7d)</th></tr></thead><tbody>{agents.map((agent) => <tr className="border-b" key={agent.userId}><td className="p-3">{agent.email}<div className="text-xs text-muted-foreground">{label(agent.role)}</div></td><td className="p-3">{agent.leadsAssigned}</td><td className="p-3">{agent.leadsNew7d}</td><td className="p-3">{agent.messagesProviderAccepted7d}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No team activity is available.</p>}
    </CardContent></Card>
  </PageShell>
}

function Metric({ title, value, hint }: { title: string; value: string | number | undefined; hint: string }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent>{value === undefined ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-semibold">{value}</div>}<p className="mt-1 text-xs text-muted-foreground">{hint}</p></CardContent></Card>
}
function Breakdown({ title, items, total }: { title: string; items?: Breakdown[]; total: number }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-3">{items ? items.map((item) => <div key={item.label}><div className="flex justify-between text-sm"><span>{label(item.label)}</span><span>{item.count} ({total ? Math.round(item.count / total * 100) : 0}%)</span></div></div>) : <Skeleton className="h-24" />}</CardContent></Card>
}
