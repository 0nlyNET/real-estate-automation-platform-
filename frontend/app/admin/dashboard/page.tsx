"use client"

import { type FormEvent, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Overview = {
  totalClients: number
  active: number
  trialing: number
  pastDue: number
  canceled: number
}

type SystemHealth = {
  totalMessages24h: number
  failedMessages24h: number
  dbConnected: boolean
}

type Tenant = {
  id: string
  name: string
  plan: string
  status: string
}

type TenantUser = {
  id: string
  tenantId: string
  email: string
  role: string
  isActive: boolean
}

type ClientSetup = {
  tenant: Tenant & { trialEndsAt: string | null }
  owner: {
    id: string
    email: string
    role: string
    isEmailVerified: boolean
  }
  temporaryPassword: string
  verifyLink: string
  verificationEmailSent: boolean
}

type ProspectApplication = {
  id: string; name: string; email: string; company?: string | null; phone?: string | null
  website?: string | null; estimatedMonthlyLeadVolume?: number | null; requestedService?: string | null
  message: string; source: string; status: string; assignedOperatorId?: string | null
  operatorNotes?: string | null; notificationStatus: string; createdAt: string; updatedAt: string
}

type OperationsTask = {
  id: string; tenantId?: string | null; category: string; title: string; description: string
  priority: string; status: string; assignedOperatorId?: string | null; dueAt?: string | null
  evidenceNote?: string | null; relatedEntityType?: string | null; relatedEntityId?: string | null
  createdAt: string; updatedAt: string
}

type SupportTicket = {
  id: string; tenantId: string; email: string; subject: string; message: string
  status: "open" | "acknowledged" | "resolved" | "closed"
  severity: "low" | "normal" | "high" | "urgent"
  assignedOperatorId?: string | null; dueAt?: string | null
  resolutionNote?: string | null; createdAt: string; updatedAt: string
}

type ReadinessItem = { key: string; label: string; passed: boolean; required: boolean }
type TenantReadiness = {
  state: string; activationStatus: string; ready: boolean
  blockers: ReadinessItem[]; required: ReadinessItem[]
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])
  const [selectedReadiness, setSelectedReadiness] = useState<TenantReadiness | null>(null)
  const [businessName, setBusinessName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientSetup, setClientSetup] = useState<ClientSetup | null>(null)
  const [applications, setApplications] = useState<ProspectApplication[]>([])
  const [tasks, setTasks] = useState<OperationsTask[]>([])
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([])
  const [taskStatus, setTaskStatus] = useState("")
  const [taskPriority, setTaskPriority] = useState("")
  const [taskTenantId, setTaskTenantId] = useState("")
  const [taskCategory, setTaskCategory] = useState("")
  const [taskOverdue, setTaskOverdue] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [o, h, t, a, q, s] = await Promise.all([
          apiFetch<Overview>("/admin/overview"),
          apiFetch<SystemHealth>("/admin/system-health"),
          apiFetch<Tenant[]>("/admin/tenants"),
          apiFetch<ProspectApplication[]>("/admin/applications?take=25"),
          apiFetch<OperationsTask[]>("/admin/operations?take=50"),
          apiFetch<SupportTicket[]>("/support/admin/tickets"),
        ])

        if (!alive) return
        setOverview(o)
        setHealth(h)
        setTenants(t)
        setApplications(a)
        setTasks(q)
        setSupportTickets(s)
      } catch (error: unknown) {
        if (!alive) return
        setError(errorMessage(error, "Failed to load admin data"))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function manageTenant(tenant: Tenant) {
    try {
      setError("")
      setSelectedTenant(tenant)
      const [users, readiness] = await Promise.all([
        apiFetch<TenantUser[]>(`/admin/tenants/${tenant.id}/users`),
        apiFetch<TenantReadiness>(`/admin/tenants/${tenant.id}/readiness`),
      ])
      setTenantUsers(users)
      setSelectedReadiness(readiness)
    } catch (error: unknown) {
      setError(errorMessage(error, "Failed to load tenant users"))
    }
  }

  async function impersonate(userId: string) {
    try {
      await apiFetch<{ user: TenantUser }>("/admin/impersonate", {
        method: "POST",
        body: { userId },
      })
      window.location.assign("/app/dashboard")
    } catch (error: unknown) {
      setError(errorMessage(error, "Impersonation failed"))
    }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      setCreatingClient(true)
      setError("")
      const result = await apiFetch<ClientSetup>("/admin/tenants", {
        method: "POST",
        body: { businessName, ownerEmail },
      })
      setClientSetup(result)
      setTenants((current) => [result.tenant, ...current])
      setBusinessName("")
      setOwnerEmail("")
    } catch (error: unknown) {
      setError(errorMessage(error, "Client workspace could not be created"))
    } finally {
      setCreatingClient(false)
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setError("Copy failed. Select the value and copy it manually.")
    }
  }

  async function updateApplication(application: ProspectApplication, status: string) {
    const operatorNotes = window.prompt("Operator notes", application.operatorNotes || "")
    if (operatorNotes === null) return
    const assignedOperatorId = window.prompt("Assigned operator user ID (optional)", application.assignedOperatorId || "")
    const updated = await apiFetch<ProspectApplication>(`/admin/applications/${application.id}`, {
      method: "PATCH", body: { status, operatorNotes, assignedOperatorId: assignedOperatorId || null },
    })
    setApplications((items) => items.map((item) => item.id === updated.id ? updated : item))
  }

  async function createOnboardingTask(applicationId: string) {
    const task = await apiFetch<OperationsTask>(`/admin/applications/${applicationId}/onboarding-task`, { method: "POST" })
    setTasks((items) => items.some((item) => item.id === task.id) ? items : [task, ...items])
  }

  async function updateTask(task: OperationsTask, status: string) {
    const evidenceNote = window.prompt("Resolution or evidence note", task.evidenceNote || "")
    if (evidenceNote === null) return
    const assignedOperatorId = window.prompt("Assigned operator user ID (optional)", task.assignedOperatorId || "")
    if (assignedOperatorId === null) return
    const dueAtInput = window.prompt("Due date/time in ISO format (optional)", task.dueAt || "")
    if (dueAtInput === null) return
    const updated = await apiFetch<OperationsTask>(`/admin/operations/${task.id}`, {
      method: "PATCH", body: { status, evidenceNote, assignedOperatorId: assignedOperatorId || null, dueAt: dueAtInput || null },
    })
    setTasks((items) => items.map((item) => item.id === updated.id ? updated : item))
  }

  async function loadTasks() {
    try {
      setError("")
      const query = new URLSearchParams({ take: "100" })
      if (taskStatus) query.set("status", taskStatus)
      if (taskPriority) query.set("priority", taskPriority)
      if (taskTenantId.trim()) query.set("tenantId", taskTenantId.trim())
      if (taskCategory.trim()) query.set("category", taskCategory.trim())
      if (taskOverdue) query.set("overdue", "true")
      setTasks(await apiFetch<OperationsTask[]>(`/admin/operations?${query.toString()}`))
    } catch (filterError: unknown) {
      setError(errorMessage(filterError, "Operations filters could not be applied"))
    }
  }

  async function updateSupportTicket(ticket: SupportTicket, status: SupportTicket["status"]) {
    const resolutionNote = window.prompt("Support resolution or evidence note", ticket.resolutionNote || "")
    if (resolutionNote === null) return
    const assignedOperatorId = window.prompt("Assigned operator user ID (optional)", ticket.assignedOperatorId || "")
    if (assignedOperatorId === null) return
    const dueAt = window.prompt("Due date/time in ISO format (optional)", ticket.dueAt || "")
    if (dueAt === null) return
    try {
      const updated = await apiFetch<SupportTicket>(`/support/admin/tickets/${ticket.id}`, {
        method: "PATCH",
        body: {
          status,
          resolutionNote: resolutionNote || null,
          assignedOperatorId: assignedOperatorId || null,
          dueAt: dueAt || null,
        },
      })
      setSupportTickets((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (supportError: unknown) {
      setError(errorMessage(supportError, "Support ticket could not be updated"))
    }
  }

  async function refreshReadiness() {
    if (!selectedTenant) return
    setSelectedReadiness(await apiFetch<TenantReadiness>(`/admin/tenants/${selectedTenant.id}/readiness`))
  }

  async function recordEvidence(patch: Record<string, unknown>) {
    if (!selectedTenant) return
    try {
      await apiFetch(`/admin/tenants/${selectedTenant.id}/onboarding-evidence`, {
        method: "POST",
        body: patch,
      })
      await refreshReadiness()
    } catch (evidenceError: unknown) {
      setError(errorMessage(evidenceError, "Launch evidence could not be recorded"))
    }
  }

  async function recordClientApproval() {
    const evidence = window.prompt("Reference the retained written client approval (do not paste secrets)")
    if (!evidence?.trim()) return
    await recordEvidence({
      clientApprovedAt: new Date().toISOString(),
      clientApprovalEvidence: evidence.trim(),
    })
  }

  async function activateSelectedTenant() {
    if (!selectedTenant) return
    try {
      const readiness = await apiFetch<TenantReadiness>(`/admin/tenants/${selectedTenant.id}/activate`, { method: "POST" })
      setSelectedReadiness(readiness)
    } catch (activationError: unknown) {
      setError(errorMessage(activationError, "Workspace activation was refused"))
      await refreshReadiness()
    }
  }

  async function pauseSelectedTenant() {
    if (!selectedTenant) return
    try {
      await apiFetch(`/admin/tenants/${selectedTenant.id}/pause`, { method: "POST" })
      await refreshReadiness()
    } catch (pauseError: unknown) {
      setError(errorMessage(pauseError, "Workspace could not be paused"))
    }
  }

  if (loading) return <div className="p-6">Loading admin dashboard...</div>

  return (
    <div className="space-y-8 p-6">

      {error ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError("")}>Dismiss</Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create a client workspace</CardTitle>
          <p className="text-sm text-muted-foreground">
            Creates an inactive onboarding workspace and the client&apos;s first owner account. Billing and automations remain blocked until verified activation. Share the temporary password separately from the verification email.
          </p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={createClient}>
            <label className="space-y-2 text-sm font-medium">
              Business name
              <Input
                required
                minLength={2}
                maxLength={120}
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="Lakeview Realty Group"
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              Owner email
              <Input
                required
                type="email"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                placeholder="broker@example.com"
              />
            </label>
            <Button type="submit" disabled={creatingClient}>
              {creatingClient ? "Creating…" : "Create client"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {clientSetup ? (
        <Card className="border-emerald-500/40">
          <CardHeader>
            <CardTitle>Client workspace created</CardTitle>
            <p className="text-sm text-muted-foreground">
              These credentials are displayed only in this browser session. Store them securely, then send the password through a separate channel.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <SetupValue
              label="Owner email"
              value={clientSetup.owner.email}
              onCopy={() => copyText(clientSetup.owner.email)}
            />
            <SetupValue
              label="Temporary password"
              value={clientSetup.temporaryPassword}
              onCopy={() => copyText(clientSetup.temporaryPassword)}
            />
            <SetupValue
              label="Verification link"
              value={clientSetup.verifyLink}
              onCopy={() => copyText(clientSetup.verifyLink)}
            />
            <div className="rounded-md bg-muted p-3 text-sm">
              {clientSetup.verificationEmailSent
                ? "Verification email sent. Share only the temporary password with the client through a separate channel."
                : "Email delivery is not connected. Send the verification link and temporary password separately, or connect SendGrid before onboarding the next client."}
            </div>
            <Button variant="outline" onClick={() => setClientSetup(null)}>Done</Button>
          </CardContent>
        </Card>
      ) : null}

      {/* REVENUE + RISK */}
      <div>
        <div className="text-2xl font-semibold mb-4">Client & Risk Overview</div>
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          <StatCard title="Total Clients" value={overview?.totalClients} />
          <StatCard title="Active" value={overview?.active} />
          <StatCard title="Trial" value={overview?.trialing} />
          <StatCard title="Past Due" value={overview?.pastDue} />
          <StatCard title="Canceled" value={overview?.canceled} />
        </div>
      </div>

      {/* SYSTEM HEALTH */}
      <div>
        <div className="text-2xl font-semibold mb-4">System Health</div>
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard title="Messages (24h)" value={health?.totalMessages24h} />
          <StatCard title="Failed (24h)" value={health?.failedMessages24h} />
          <StatCard title="DB Connected" value={health?.dbConnected ? "Yes" : "No"} />
        </div>
      </div>

      {/* CLIENT LIST */}
      <div>
        <div className="text-2xl font-semibold mb-4">Clients</div>
        <Card>
          <CardContent className="space-y-3">
            {tenants.map((t) => (
              <div id={`tenant-${t.id}`} key={t.id} className="flex justify-between border p-3 rounded-md">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {t.plan} • {t.status}
                  </div>
                </div>
                <Button variant="outline" onClick={() => manageTenant(t)}>Manage</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="mb-4 text-2xl font-semibold">Prospect applications</div>
        <Card><CardContent className="space-y-3 pt-6">
          {applications.map((application) => <div id={`application-${application.id}`} key={application.id} className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-medium">{application.company || application.name}</div><div className="text-sm text-muted-foreground">{application.email} · {application.phone || "no phone"} · {application.status} · notification {application.notificationStatus}</div></div><div className="text-xs text-muted-foreground">Received {new Date(application.createdAt).toLocaleString()}</div></div>
            <p className="text-sm">{application.message}</p>
            <div className="text-xs text-muted-foreground">Service: {application.requestedService || "not specified"} · Volume: {application.estimatedMonthlyLeadVolume ?? "not specified"} · Source: {application.source}</div>
            {application.operatorNotes ? <div className="rounded bg-muted p-2 text-sm">Notes: {application.operatorNotes}</div> : null}
            <div className="flex flex-wrap gap-2">
              {["reviewing", "qualified", "consultation_booked", "accepted", "declined"].map((status) => <Button key={status} size="sm" variant="outline" onClick={() => void updateApplication(application, status)}>{status.replaceAll("_", " ")}</Button>)}
              <Button size="sm" onClick={() => void createOnboardingTask(application.id)}>Create onboarding task</Button>
            </div>
          </div>)}
          {!applications.length ? <p className="text-sm text-muted-foreground">No applications.</p> : null}
        </CardContent></Card>
      </div>

      <div>
        <div className="mb-4 text-2xl font-semibold">Support tickets</div>
        <Card><CardContent className="space-y-3 pt-6">
          {supportTickets.map((ticket) => <div id={`support-${ticket.id}`} key={ticket.id} className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="font-medium">{ticket.subject}</div><div className="text-xs text-muted-foreground">{ticket.severity} · {ticket.status} · workspace {ticket.tenantId}</div></div>
              <div className="text-right text-xs text-muted-foreground">Due {ticket.dueAt ? new Date(ticket.dueAt).toLocaleString() : "not set"}<br />Updated {new Date(ticket.updatedAt).toLocaleString()}</div>
            </div>
            <p className="text-sm">{ticket.message}</p>
            <div className="text-xs text-muted-foreground">Owner: {ticket.assignedOperatorId || "unassigned"} · Requester: {ticket.email}</div>
            {ticket.resolutionNote ? <div className="rounded bg-muted p-2 text-sm">Resolution: {ticket.resolutionNote}</div> : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void updateSupportTicket(ticket, "acknowledged")}>Acknowledge / assign</Button>
              <Button size="sm" onClick={() => void updateSupportTicket(ticket, "resolved")}>Resolve</Button>
              {ticket.status === "resolved" || ticket.status === "closed" ? <Button size="sm" variant="outline" onClick={() => void updateSupportTicket(ticket, "open")}>Reopen</Button> : null}
            </div>
          </div>)}
          {!supportTickets.length ? <p className="text-sm text-muted-foreground">No support tickets.</p> : null}
        </CardContent></Card>
      </div>

      <div>
        <div className="mb-4 text-2xl font-semibold">Operations queue</div>
        <Card className="mb-4"><CardContent className="grid gap-3 pt-6 md:grid-cols-3 lg:grid-cols-6">
          <select className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="Operations status" value={taskStatus} onChange={(event) => setTaskStatus(event.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="resolved">Resolved</option></select>
          <select className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="Operations priority" value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)}><option value="">All priorities</option><option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
          <Input aria-label="Operations tenant ID" value={taskTenantId} onChange={(event) => setTaskTenantId(event.target.value)} placeholder="Tenant ID" />
          <Input aria-label="Operations category" value={taskCategory} onChange={(event) => setTaskCategory(event.target.value)} placeholder="Exact category" />
          <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm"><input type="checkbox" checked={taskOverdue} onChange={(event) => setTaskOverdue(event.target.checked)} /> Overdue only</label>
          <Button onClick={() => void loadTasks()}>Apply filters</Button>
        </CardContent></Card>
        <Card><CardContent className="space-y-3 pt-6">
          {tasks.map((task) => <div key={task.id} className="flex flex-wrap items-start justify-between gap-4 rounded-md border p-4">
            <div className="min-w-0 flex-1"><div className="font-medium">{task.title}</div><div className="text-xs text-muted-foreground">{task.category} · {task.priority} · {task.status} · due {task.dueAt ? new Date(task.dueAt).toLocaleString() : "not set"}</div><div className="mt-1 text-xs text-muted-foreground">Owner: {task.assignedOperatorId || "unassigned"} · Created {new Date(task.createdAt).toLocaleString()} · Updated {new Date(task.updatedAt).toLocaleString()}</div><p className="mt-2 text-sm">{task.description}</p>{task.relatedEntityType && task.relatedEntityId ? <p className="mt-2 text-xs text-muted-foreground">Related: {task.relatedEntityType} · {task.relatedEntityId} {taskRelatedHref(task) ? <a className="ml-2 underline" href={taskRelatedHref(task) || undefined}>Open related record</a> : null}</p> : null}{task.evidenceNote ? <p className="mt-2 rounded bg-muted p-2 text-sm">Evidence: {task.evidenceNote}</p> : null}</div>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void updateTask(task, task.status === "resolved" ? "open" : "in_progress")}>{task.status === "resolved" ? "Reopen" : "Take"}</Button><Button size="sm" onClick={() => void updateTask(task, "resolved")}>Resolve</Button></div>
          </div>)}
          {!tasks.length ? <p className="text-sm text-muted-foreground">Queue is clear.</p> : null}
        </CardContent></Card>
      </div>

      {selectedTenant ? (
        <Card>
          <CardHeader><CardTitle>{selectedTenant.name} launch controls</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="mb-5 space-y-3 rounded-md border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><div className="font-medium">Readiness: {selectedReadiness?.ready ? "ready for operator activation" : "blocked"}</div><div className="text-xs text-muted-foreground">Lifecycle {selectedReadiness?.state || "loading"} · {selectedReadiness?.activationStatus || "unknown"}</div></div>
                <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void refreshReadiness()}>Refresh</Button><Button size="sm" variant="outline" onClick={() => void pauseSelectedTenant()}>Pause now</Button><Button size="sm" disabled={!selectedReadiness?.ready} onClick={() => void activateSelectedTenant()}>Activate</Button></div>
              </div>
              {selectedReadiness?.blockers.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{selectedReadiness.blockers.map((item) => <li key={item.key}>{item.label}</li>)}</ul> : <p className="text-sm text-muted-foreground">All calculated requirements pass. Review the evidence once more before activation.</p>}
              <div className="border-t pt-3"><div className="mb-2 text-sm font-medium">Record operator evidence only after retaining the real test result</div><div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => window.confirm("Confirm the consent policy and disclosure evidence were reviewed") && void recordEvidence({ consentPolicyAcknowledgedAt: new Date().toISOString() })}>Consent reviewed</Button>
                <Button size="sm" variant="outline" onClick={() => window.confirm("Confirm a controlled test lead completed") && void recordEvidence({ testLeadCompletedAt: new Date().toISOString() })}>Test lead passed</Button>
                <Button size="sm" variant="outline" onClick={() => window.confirm("Confirm inbound SMS was tested") && void recordEvidence({ inboundSmsTestedAt: new Date().toISOString() })}>Inbound SMS passed</Button>
                <Button size="sm" variant="outline" onClick={() => window.confirm("Confirm STOP behavior was tested") && void recordEvidence({ stopTestedAt: new Date().toISOString() })}>STOP passed</Button>
                <Button size="sm" variant="outline" onClick={() => window.confirm("Confirm provider rejection appeared as Failed and created operations work") && void recordEvidence({ providerRejectionTestedAt: new Date().toISOString() })}>Rejection visibility passed</Button>
                <Button size="sm" variant="outline" onClick={() => window.confirm("Confirm billing state and Stripe mapping were reconciled") && void recordEvidence({ billingVerifiedAt: new Date().toISOString() })}>Billing verified</Button>
                <Button size="sm" variant="outline" onClick={() => void recordClientApproval()}>Record client approval</Button>
                <Button size="sm" variant="outline" onClick={() => window.confirm("Record the current platform administrator's launch approval") && void recordEvidence({ operatorApproved: true })}>Record operator approval</Button>
              </div></div>
            </div>
            <div className="font-medium">Workspace users</div>
            {tenantUsers.map((user) => (
              <div key={user.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{user.email}</div>
                  <div className="text-sm text-muted-foreground">{user.role} · {user.isActive ? "active" : "inactive"}</div>
                </div>
                <Button disabled={!user.isActive} onClick={() => impersonate(user.id)}>Open workspace</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

    </div>
  )
}

function taskRelatedHref(task: OperationsTask) {
  if (task.relatedEntityType === "prospect_application" && task.relatedEntityId)
    return `#application-${task.relatedEntityId}`
  if (task.relatedEntityType === "support_ticket" && task.relatedEntityId)
    return `#support-${task.relatedEntityId}`
  if (task.tenantId) return `#tenant-${task.tenantId}`
  return null
}

function SetupValue({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => void
}) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">{value}</code>
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>Copy</Button>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
}: {
  title: string
  value: string | number | null | undefined
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold">
        {value ?? "-"}
      </CardContent>
    </Card>
  )
}
