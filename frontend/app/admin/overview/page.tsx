"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Eye,
  Flame,
  Handshake,
  ListTodo,
  PauseCircle,
  PlayCircle,
  Users,
} from "lucide-react"
import { apiFetch } from "@/lib/api"
import { fetchMe, type Me } from "@/lib/me"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Overview = {
  totalClients: number
  active: number
  onboarding: number
  newApplications: number
  openTasks: number
  urgentTasks: number
  openSupport: number
  pastDue?: number
}

type ServiceState = {
  state: "active" | "payment_overdue" | "grace_period" | "suspended" | "paused" | "onboarding" | "canceled"
  label: string
  reason: string
  graceEndsAt: string | null
}

type Tenant = {
  id: string
  name: string
  status?: string
  lifecycleStatus: string
  serviceState: ServiceState
  serviceSuspendedAt?: string | null
  serviceSuspensionReason?: string | null
  assignedOperatorId?: string | null
}

type OperationsTask = {
  id: string
  tenantId?: string | null
  title: string
  description: string
  priority: "low" | "normal" | "high" | "critical"
  status: "open" | "in_progress" | "blocked" | "resolved"
  dueAt?: string | null
}

type Handoff = {
  id: string
  priority: "normal" | "high" | "urgent"
  status: "open" | "opened" | "snoozed" | "completed"
  reason: string
  recommendedAction: string
  tenant: { id: string; name: string }
  lead: { id: string; fullName: string }
}

type Appointment = {
  id: string
  startsAt: string
  status: string
  confirmationStatus: string
  tenant: { id: string; name: string }
  lead: { id: string; fullName: string }
}

type LeadAttention = {
  id: string
  fullName: string
  stage: string
  temperature: "hot" | "warm" | "cold"
  readinessLevel: "not_ready" | "exploring" | "ready" | "urgent"
  recommendedNextAction?: string | null
  createdAt: string
  tenant: { id: string; name: string }
}

type TenantUser = {
  id: string
  role: string
  isActive: boolean
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function time(value?: string | null) {
  if (!value) return "No due time"
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function serviceBadge(state: ServiceState["state"]) {
  if (state === "active") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (state === "suspended" || state === "payment_overdue") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
  if (state === "grace_period") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  return "border-border bg-muted text-muted-foreground"
}

export default function AdminOverviewPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [tasks, setTasks] = useState<OperationsTask[]>([])
  const [leadAttention, setLeadAttention] = useState<LeadAttention[]>([])
  const [handoffs, setHandoffs] = useState<Handoff[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      const current = await fetchMe()
      if (!current?.platformRole) throw new Error("Platform access is required")
      setMe(current)
      const [nextOverview, nextTenants, nextTasks, nextLeads, nextHandoffs, nextAppointments] =
        await Promise.all([
          apiFetch<Overview>("/admin/overview"),
          apiFetch<Tenant[]>("/admin/tenants"),
          apiFetch<OperationsTask[]>("/admin/operations?take=50"),
          apiFetch<LeadAttention[]>("/admin/lead-attention?take=50"),
          apiFetch<Handoff[]>("/admin/client-operations/handoffs?take=50"),
          apiFetch<Appointment[]>("/admin/client-operations/appointments?take=50"),
        ])
      setOverview(nextOverview)
      setTenants(nextTenants)
      setTasks(nextTasks)
      setLeadAttention(nextLeads)
      setHandoffs(nextHandoffs)
      setAppointments(nextAppointments)
    } catch (cause) {
      setError(messageFor(cause, "The admin overview could not be loaded"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const today = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return appointments
      .filter((item) => {
        const starts = new Date(item.startsAt)
        return starts >= start && starts < end && !["cancelled", "completed"].includes(item.status)
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
  }, [appointments])

  const openTasks = useMemo(
    () =>
      tasks
        .filter((item) => item.status !== "resolved")
        .sort((a, b) => {
          const rank = { critical: 4, high: 3, normal: 2, low: 1 }
          return rank[b.priority] - rank[a.priority]
        }),
    [tasks],
  )
  const openHandoffs = handoffs.filter((item) => item.status !== "completed")
  const clientAttention = tenants.filter(
    (tenant) =>
      tenant.serviceState.state !== "active" ||
      ["past_due", "unpaid"].includes(tenant.status || ""),
  )
  const isOwner = me?.platformRole === "super_admin"

  async function suspend(tenant: Tenant) {
    if (!window.confirm(`Stop all automated services for ${tenant.name}? Leads and history will be preserved.`)) return
    setBusy(tenant.id)
    setError("")
    try {
      await apiFetch(`/admin/tenants/${tenant.id}/suspend`, {
        method: "POST",
        body: { reason: "Services manually suspended by the RealtyTechAI platform administrator." },
      })
      await load()
    } catch (cause) {
      setError(messageFor(cause, "Services could not be suspended"))
    } finally {
      setBusy(null)
    }
  }

  async function restore(tenant: Tenant) {
    setBusy(tenant.id)
    setError("")
    try {
      await apiFetch(`/admin/tenants/${tenant.id}/restore`, { method: "POST" })
      await load()
    } catch (cause) {
      setError(messageFor(cause, "Services could not be restored"))
    } finally {
      setBusy(null)
    }
  }

  async function viewAsClient(tenant: Tenant) {
    setBusy(`view:${tenant.id}`)
    setError("")
    try {
      const users = await apiFetch<TenantUser[]>(`/admin/tenants/${tenant.id}/users`)
      const target = users.find((user) => user.isActive && user.role === "owner")
        || users.find((user) => user.isActive && user.role === "admin")
      if (!target) throw new Error("This client does not have an active owner or admin account")
      await apiFetch("/admin/impersonate", {
        method: "POST",
        body: { userId: target.id },
      })
      window.location.assign("/app/dashboard")
    } catch (cause) {
      setError(messageFor(cause, "The client view could not be opened"))
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading your operating center…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">RealtyTechAI operations</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">What needs your attention today</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage clients, service status, tasks, handoffs, and appointments from one place.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/dashboard">Open full operations</Link>
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Summary icon={Users} label="Clients needing attention" value={clientAttention.length} />
        <Summary icon={Flame} label="New / urgent leads" value={leadAttention.length} />
        <Summary icon={Handshake} label="Open handoffs" value={openHandoffs.length} />
        <Summary icon={CalendarDays} label="Today’s appointments" value={today.length} />
        <Summary icon={ListTodo} label="Open tasks" value={openTasks.length} />
        <Summary icon={CreditCard} label="Payment issues" value={overview?.pastDue || 0} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader>
            <CardTitle>Clients</CardTitle>
            <p className="text-sm text-muted-foreground">
              Open a workspace, view what the client sees, or safely control service.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {tenants.map((tenant) => (
              <div key={tenant.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{tenant.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tenant.serviceState.reason}</div>
                  </div>
                  <Badge variant="outline" className={serviceBadge(tenant.serviceState.state)}>
                    {tenant.serviceState.label}
                  </Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href={`/admin/dashboard?view=onboarding&tenantId=${tenant.id}`}>
                      Open client workspace
                    </Link>
                  </Button>
                  {isOwner ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `view:${tenant.id}`}
                      onClick={() => void viewAsClient(tenant)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View as client
                    </Button>
                  ) : null}
                  {isOwner && tenant.serviceState.state === "suspended" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === tenant.id}
                      onClick={() => void restore(tenant)}
                    >
                      <PlayCircle className="mr-2 h-4 w-4" />
                      Restore services
                    </Button>
                  ) : isOwner && tenant.lifecycleStatus === "ACTIVE" ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === tenant.id}
                      onClick={() => void suspend(tenant)}
                    >
                      <PauseCircle className="mr-2 h-4 w-4" />
                      Stop all services
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {!tenants.length ? <Empty text="No client workspaces yet." /> : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Next actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {clientAttention.slice(0, 4).map((tenant) => (
                <Attention
                  key={`client:${tenant.id}`}
                  icon={tenant.serviceState.state === "suspended" ? PauseCircle : AlertTriangle}
                  title={tenant.name}
                  detail={tenant.serviceState.label}
                  href={`/admin/dashboard?view=onboarding&tenantId=${tenant.id}`}
                />
              ))}
              {leadAttention.slice(0, 3).map((lead) => (
                <Attention
                  key={`lead:${lead.id}`}
                  icon={Flame}
                  title={`${lead.fullName} · ${lead.readinessLevel === "urgent" ? "urgent" : lead.stage}`}
                  detail={`${lead.tenant.name} · ${lead.recommendedNextAction || "Review this lead"}`}
                  href={`/admin/dashboard?view=onboarding&tenantId=${lead.tenant.id}`}
                />
              ))}
              {openHandoffs.slice(0, 3).map((handoff) => (
                <Attention
                  key={`handoff:${handoff.id}`}
                  icon={Handshake}
                  title={`${handoff.lead.fullName} needs a handoff`}
                  detail={`${handoff.tenant.name} · ${handoff.recommendedAction}`}
                  href="/admin/dashboard?view=handoffs"
                />
              ))}
              {!clientAttention.length && !leadAttention.length && !openHandoffs.length ? (
                <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  No urgent client actions.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {today.slice(0, 4).map((appointment) => (
                <Attention
                  key={appointment.id}
                  icon={CalendarDays}
                  title={appointment.lead.fullName}
                  detail={`${appointment.tenant.name} · ${time(appointment.startsAt)}`}
                  href="/admin/dashboard?view=appointments"
                />
              ))}
              {openTasks.slice(0, 4).map((task) => (
                <Attention
                  key={task.id}
                  icon={ListTodo}
                  title={task.title}
                  detail={`${task.priority} priority${task.dueAt ? ` · ${time(task.dueAt)}` : ""}`}
                  href="/admin/dashboard?view=tasks"
                />
              ))}
              {!today.length && !openTasks.length ? <Empty text="Nothing is due today." /> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Summary({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function Attention({
  icon: Icon,
  title,
  detail,
  href,
}: {
  icon: typeof Users
  title: string
  detail: string
  href: string
}) {
  return (
    <Link href={href} className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</div>
      </div>
    </Link>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">{text}</div>
}
