"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Inbox,
  Handshake,
  LifeBuoy,
  ListTodo,
  Plug,
  PauseCircle,
  Search,
  Settings2,
  UserPlus,
  Users,
} from "lucide-react"
import { apiFetch } from "@/lib/api"
import { fetchMe, type Me } from "@/lib/me"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import ManagedIntegrations from "@/components/admin/managed-integrations"

type View = "overview" | "leads" | "clients" | "handoffs" | "appointments" | "onboarding" | "tasks" | "support" | "activity" | "integrations" | "ai" | "billing"
type Overview = {
  totalClients: number; active: number; onboarding: number; newApplications: number
  openTasks: number; urgentTasks: number; openSupport: number
  trialing?: number; pastDue?: number; canceled?: number
}
type BillingOverview = {
  mrrByCurrency: Record<string, number>
  live: {
    collectedThisMonth: Array<{ currency: string; amountCents: string }>
    collectedThisYear: Array<{ currency: string; amountCents: string }>
    eventCounts30: Record<string, number>
    recentEvents: Array<{ id: string; tenantName: string; eventType: string; amountCents: string | number; currency: string; occurredAt: string }>
  }
  test: { collectedThisMonth: Array<{ currency: string; amountCents: string }> }
  subscriptionCounts: { active: number; trialing: number; pastDue: number; canceled: number }
  upcomingRenewals: Array<{ tenantId: string; tenantName: string; renewsAt: string; amountCents?: number | null; currency?: string | null }>
  pastDueClients: number
}
type SystemHealth = {
  totalMessages24h: number; failedMessages24h: number; dbConnected: boolean
  environment?: { devicePush?: { status: string }; billing?: { status: string }; systemEmail?: { status: string }; retention?: { days: number } }
}
type BusinessReport = {
  last30Days: {
    applications: number; consultations: number; accepted: number; conversionRate: number | null
    newClients: number; supportRequests: number; averageHoursToLaunch: number | null
    collectedByCurrency?: Record<string, number>
  }
  weekly: Array<{ start: string; applications: number; clients: number }>
}
type Operator = { id: string; email: string; platformRole: "super_admin" | "staff" }
type PlatformAccessUser = { id: string; email: string; isActive: boolean; isEmailVerified: boolean; platformRole: "super_admin" | "staff" | null; accessManagedByEnvironment: boolean }
type Tenant = {
  id: string; name: string; status?: string; lifecycleStatus: string; assignedOperatorId?: string | null
  serviceState?: { state: string; label: string; reason: string; graceEndsAt?: string | null }
  serviceSuspendedAt?: string | null; serviceSuspensionReason?: string | null
  currentPeriodEnd?: string | null; lastPaymentFailureAt?: string | null; createdAt: string; updatedAt: string
}
type ProspectApplication = {
  id: string; name: string; email: string; company?: string | null; phone?: string | null
  website?: string | null; estimatedMonthlyLeadVolume?: number | null; requestedService?: string | null
  message: string; source: string; status: string; assignedOperatorId?: string | null
  operatorNotes?: string | null; notificationStatus: string; createdAt: string; updatedAt: string
}
type OperationsTask = {
  id: string; tenantId?: string | null; category: string; title: string; description: string
  priority: "low" | "normal" | "high" | "critical"; status: "open" | "in_progress" | "blocked" | "resolved"
  assignedOperatorId?: string | null; dueAt?: string | null; evidenceNote?: string | null
  relatedEntityType?: string | null; relatedEntityId?: string | null; createdAt: string; updatedAt: string
}
type SupportTicket = {
  id: string; tenantId: string; email: string; subject: string; message: string
  status: "open" | "acknowledged" | "resolved" | "closed"
  severity: "low" | "normal" | "high" | "urgent"
  assignedOperatorId?: string | null; dueAt?: string | null; resolutionNote?: string | null
  createdAt: string; updatedAt: string
}
type Communication = {
  id: string; tenantId: string; leadId: string; leadName: string; channel: string; direction: string
  body: string; status: string; providerStatus?: string | null; createdAt: string
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
type Connection = { tenantId: string; tenantName: string; provider: string; status: string; updatedAt: string }
type ClientHandoff = {
  id: string; tenantId: string; priority: "normal" | "high" | "urgent"; status: "open" | "opened" | "snoozed" | "completed"
  reason: string; summary: string; recommendedAction: string; dueAt?: string | null; completionNote?: string | null
  tenant: { id: string; name: string }; lead: { id: string; fullName: string; leadType: string; temperature: string }
}
type ClientAppointment = {
  id: string; tenantId: string; startsAt: string; endsAt: string; status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show"
  confirmationStatus: string; followUpStatus: string; calendarSource: string; notes?: string | null
  tenant: { id: string; name: string }; lead: { id: string; fullName: string }
}
type TenantUser = { id: string; tenantId: string; email: string; role: string; isActive: boolean }
type ReadinessItem = { key: string; label: string; passed: boolean; required: boolean }
type TenantReadiness = { state: string; activationStatus: string; ready: boolean; blockers: ReadinessItem[]; required: ReadinessItem[] }
type ClientSetup = {
  tenant: Tenant; owner: { id: string; email: string; role: string; isEmailVerified: boolean }
  temporaryPassword: string; verifyLink: string; verificationEmailSent: boolean
}
type AiOverview = {
  platformPaused: boolean
  platformPauseReason?: string | null
  aiEnabledClients: number
  activeAiConversations: number
  humanControlledConversations: number
  humanTakeovers: number
  waitingForHuman: number
  failedRuns: number
  blockedRuns: number
  usageLimitViolations?: number
  clients: Array<{
    tenantId: string
    tenantName: string
    aiEnabled: boolean
    aiPaused: boolean
    mode: string
    configurationApprovalStatus: string
    usage: number
    estimatedCostUsd: number
    monthlyUsageLimit: number
  }>
}

const views: Array<{ id: View; label: string; icon: typeof Users; ownerOnly?: boolean }> = [
  { id: "overview", label: "Today", icon: Activity },
  { id: "leads", label: "Leads", icon: Inbox },
  { id: "clients", label: "Clients", icon: Users },
  { id: "handoffs", label: "Handoffs", icon: Handshake },
  { id: "appointments", label: "Appointments", icon: CalendarDays },
  { id: "onboarding", label: "Onboarding", icon: ClipboardCheck },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "support", label: "Support", icon: LifeBuoy },
  { id: "activity", label: "Activity", icon: Plug },
  { id: "integrations", label: "Integrations", icon: Settings2, ownerOnly: true },
  { id: "ai", label: "AI operations", icon: Bot },
  { id: "billing", label: "Billing & health", icon: CreditCard, ownerOnly: true },
]

type DataSection =
  | "overview"
  | "clients"
  | "applications"
  | "tasks"
  | "support"
  | "operators"
  | "communications"
  | "leadAttention"
  | "integrations"
  | "reporting"
  | "handoffs"
  | "appointments"
  | "ai"
  | "billing"
  | "health"
  | "access"

const sharedDataSections: DataSection[] = [
  "overview",
  "clients",
  "applications",
  "tasks",
  "support",
  "operators",
  "communications",
  "leadAttention",
  "integrations",
  "reporting",
  "handoffs",
  "appointments",
  "ai",
]
const ownerDataSections: DataSection[] = ["billing", "health", "access"]
const dataSectionLabels: Record<DataSection, string> = {
  overview: "business summary",
  clients: "clients",
  applications: "applications",
  tasks: "operations tasks",
  support: "support requests",
  operators: "staff assignments",
  communications: "communications history",
  leadAttention: "client lead attention",
  integrations: "integration readiness",
  reporting: "business reporting",
  handoffs: "client handoffs",
  appointments: "appointments",
  ai: "AI operations",
  billing: "billing",
  health: "system health",
  access: "staff access",
}
const viewDataSections: Record<View, DataSection[]> = {
  overview: ["overview", "clients", "applications", "tasks", "support", "leadAttention", "reporting", "handoffs", "appointments"],
  leads: ["applications", "leadAttention", "operators"],
  clients: ["clients", "operators"],
  handoffs: ["handoffs"],
  appointments: ["appointments"],
  onboarding: ["clients", "operators"],
  tasks: ["tasks", "operators"],
  support: ["support", "operators"],
  activity: ["integrations", "communications"],
  integrations: [],
  ai: ["ai"],
  billing: ["billing", "health", "access"],
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function label(value?: string | null) {
  return String(value || "not set").replaceAll("_", " ")
}

function currency(cents: number | string, code = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code.toUpperCase() }).format(Number(cents || 0) / 100)
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [me, setMe] = useState<Me | null>(null)
  const [view, setView] = useState<View>("overview")
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<DataSection, string>>>({})
  const [sectionLoading, setSectionLoading] = useState<Partial<Record<DataSection, boolean>>>({})
  const [overview, setOverview] = useState<Overview | null>(null)
  const [billing, setBilling] = useState<BillingOverview | null>(null)
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [report, setReport] = useState<BusinessReport | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [applications, setApplications] = useState<ProspectApplication[]>([])
  const [tasks, setTasks] = useState<OperationsTask[]>([])
  const [support, setSupport] = useState<SupportTicket[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [platformUsers, setPlatformUsers] = useState<PlatformAccessUser[]>([])
  const [communications, setCommunications] = useState<Communication[]>([])
  const [leadAttention, setLeadAttention] = useState<LeadAttention[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [handoffs, setHandoffs] = useState<ClientHandoff[]>([])
  const [appointments, setAppointments] = useState<ClientAppointment[]>([])
  const [aiOverview, setAiOverview] = useState<AiOverview | null>(null)
  const [search, setSearch] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [evidence, setEvidence] = useState<Record<string, string>>({})
  const [businessName, setBusinessName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [newClientOwner, setNewClientOwner] = useState("")
  const [sourceApplicationId, setSourceApplicationId] = useState<string | null>(null)
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientSetup, setClientSetup] = useState<ClientSetup | null>(null)
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])
  const [readiness, setReadiness] = useState<TenantReadiness | null>(null)

  const isOwner = me?.platformRole === "super_admin"

  const loadDataSection = useCallback(async (section: DataSection) => {
    setSectionLoading((current) => ({ ...current, [section]: true }))
    try {
      if (section === "overview") setOverview(await apiFetch<Overview>("/admin/overview"))
      if (section === "clients") setTenants(await apiFetch<Tenant[]>("/admin/tenants"))
      if (section === "applications") {
        const nextApplications = await apiFetch<ProspectApplication[]>("/admin/applications?take=100")
        setApplications(nextApplications)
        setNotes(Object.fromEntries(nextApplications.map((item) => [item.id, item.operatorNotes || ""])))
      }
      if (section === "tasks") setTasks(await apiFetch<OperationsTask[]>("/admin/operations?take=100"))
      if (section === "support") setSupport(await apiFetch<SupportTicket[]>("/support/admin/tickets"))
      if (section === "operators") setOperators(await apiFetch<Operator[]>("/admin/operators"))
      if (section === "communications") setCommunications(await apiFetch<Communication[]>("/admin/communications?take=50"))
      if (section === "leadAttention") setLeadAttention(await apiFetch<LeadAttention[]>("/admin/lead-attention?take=50"))
      if (section === "integrations") setConnections(await apiFetch<Connection[]>("/admin/integrations-overview"))
      if (section === "reporting") setReport(await apiFetch<BusinessReport>("/admin/reporting-overview"))
      if (section === "handoffs") setHandoffs(await apiFetch<ClientHandoff[]>("/admin/client-operations/handoffs?take=100"))
      if (section === "appointments") setAppointments(await apiFetch<ClientAppointment[]>("/admin/client-operations/appointments?take=100"))
      if (section === "ai") setAiOverview(await apiFetch<AiOverview>("/admin/ai/overview"))
      if (section === "billing") setBilling(await apiFetch<BillingOverview>("/admin/billing-overview"))
      if (section === "health") setHealth(await apiFetch<SystemHealth>("/admin/system-health"))
      if (section === "access") setPlatformUsers(await apiFetch<PlatformAccessUser[]>("/admin/platform-access"))
      setSectionErrors((current) => {
        const next = { ...current }
        delete next[section]
        return next
      })
    } catch (cause) {
      setSectionErrors((current) => ({
        ...current,
        [section]: messageFor(cause, `${dataSectionLabels[section]} could not be loaded`),
      }))
      throw cause
    } finally {
      setSectionLoading((current) => ({ ...current, [section]: false }))
    }
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setAccessError("")
    try {
      const current = await fetchMe()
      if (!current?.platformRole) throw new Error("Platform access is required")
      setMe(current)
      const requested = new URLSearchParams(window.location.search).get("view") as View | null
      if (requested && views.some((item) => item.id === requested && (!item.ownerOnly || current.platformRole === "super_admin"))) setView(requested)
      const sections = current.platformRole === "super_admin"
        ? [...sharedDataSections, ...ownerDataSections]
        : sharedDataSections
      await Promise.allSettled(sections.map((section) => loadDataSection(section)))
    } catch (cause) {
      setMe(null)
      setAccessError(messageFor(cause, "The admin workspace could not be accessed"))
    } finally {
      setLoading(false)
    }
  }, [loadDataSection])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadAll(), 0)
    return () => window.clearTimeout(initialLoad)
  }, [loadAll])

  useEffect(() => {
    if (!me) return
    const syncView = window.setTimeout(() => {
      const requested = searchParams.get("view") as View | null
      const permitted = requested && views.some(
        (item) => item.id === requested && (!item.ownerOnly || me.platformRole === "super_admin"),
      )
      setView(permitted ? requested : "overview")
    }, 0)
    return () => window.clearTimeout(syncView)
  }, [me, searchParams])

  useEffect(() => {
    if (!me) return
    const tenantId = searchParams.get("tenantId")
    if (!tenantId) {
      setSelectedTenant(null)
      setTenantUsers([])
      setReadiness(null)
      return
    }
    if (selectedTenant?.id === tenantId) return
    const requestedTenant = tenants.find((tenant) => tenant.id === tenantId)
    if (!requestedTenant) {
      setSelectedTenant(null)
      setTenantUsers([])
      setReadiness(null)
      return
    }
    setSelectedTenant(requestedTenant)
    setTenantUsers([])
    setReadiness(null)
    void Promise.all([
      apiFetch<TenantUser[]>(`/admin/tenants/${requestedTenant.id}/users`),
      apiFetch<TenantReadiness>(`/admin/tenants/${requestedTenant.id}/readiness`),
    ]).then(([users, status]) => {
      setTenantUsers(users)
      setReadiness(status)
    }).catch((cause) => {
      setError(messageFor(cause, "Client details could not be loaded"))
    })
  }, [me, searchParams, selectedTenant?.id, tenants])

  const operatorName = (id?: string | null) => operators.find((operator) => operator.id === id)?.email || "Unassigned"
  const normalizedSearch = search.trim().toLowerCase()
  const matches = (text: string) => !normalizedSearch || text.toLowerCase().includes(normalizedSearch)
  const ownerMatches = (id?: string | null) => ownerFilter === "all" || (ownerFilter === "unassigned" ? !id : id === ownerFilter)
  const filteredApplications = applications.filter((item) => matches(`${item.name} ${item.company} ${item.email}`) && ownerMatches(item.assignedOperatorId) && (statusFilter === "all" || item.status === statusFilter))
  const filteredTenants = tenants.filter((item) => matches(item.name) && ownerMatches(item.assignedOperatorId) && (statusFilter === "all" || item.lifecycleStatus === statusFilter))
  const filteredTasks = tasks.filter((item) => matches(`${item.title} ${item.description} ${item.category}`) && ownerMatches(item.assignedOperatorId) && (statusFilter === "all" || item.status === statusFilter))
  const filteredLeadAttention = leadAttention.filter((item) => matches(`${item.fullName} ${item.tenant.name} ${item.recommendedNextAction || ""}`) && (statusFilter === "all" || item.stage === statusFilter || item.readinessLevel === statusFilter || item.temperature === statusFilter))
  const filteredHandoffs = handoffs.filter((item) => matches(`${item.tenant.name} ${item.lead.fullName} ${item.reason}`) && (statusFilter === "all" || item.status === statusFilter))
  const filteredAppointments = appointments.filter((item) => matches(`${item.tenant.name} ${item.lead.fullName}`) && (statusFilter === "all" || item.status === statusFilter))

  function switchView(next: View, tenantId?: string) {
    setView(next); setStatusFilter("all"); setSearch(""); setOwnerFilter("all")
    const query = new URLSearchParams({ view: next })
    if (tenantId) query.set("tenantId", tenantId)
    router.push(`/admin/dashboard?${query.toString()}`, { scroll: false })
  }

  async function patchApplication(item: ProspectApplication, patch: Record<string, unknown>) {
    try {
      const updated = await apiFetch<ProspectApplication>(`/admin/applications/${item.id}`, { method: "PATCH", body: patch })
      setApplications((current) => current.map((row) => row.id === updated.id ? updated : row))
      setNotice("Lead updated.")
    } catch (cause) { setError(messageFor(cause, "Lead could not be updated")) }
  }

  function prepareClient(item: ProspectApplication) {
    setBusinessName(item.company || item.name); setOwnerEmail(item.email); setNewClientOwner(item.assignedOperatorId || "")
    setSourceApplicationId(item.id); switchView("clients"); window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreatingClient(true); setError("")
    try {
      const result = await apiFetch<ClientSetup>("/admin/tenants", { method: "POST", body: { businessName, ownerEmail, assignedOperatorId: newClientOwner || null } })
      setClientSetup(result); setTenants((current) => [result.tenant, ...current])
      if (sourceApplicationId) {
        const source = applications.find((item) => item.id === sourceApplicationId)
        if (source) await patchApplication(source, { status: "accepted", operatorNotes: notes[source.id] || source.operatorNotes || "Converted to client workspace." })
      }
      setBusinessName(""); setOwnerEmail(""); setNewClientOwner(""); setSourceApplicationId(null)
      setNotice("Client workspace created. Follow the handoff steps below.")
    } catch (cause) { setError(messageFor(cause, "Client workspace could not be created")) }
    finally { setCreatingClient(false) }
  }

  async function patchTask(item: OperationsTask, patch: Record<string, unknown>) {
    try {
      const updated = await apiFetch<OperationsTask>(`/admin/operations/${item.id}`, { method: "PATCH", body: patch })
      setTasks((current) => current.map((row) => row.id === updated.id ? updated : row)); setNotice("Task updated.")
    } catch (cause) { setError(messageFor(cause, "Task could not be updated")) }
  }

  async function patchHandoff(item: ClientHandoff, patch: { action: "opened" | "completed" | "snoozed"; note?: string; snoozedUntil?: string }) {
    try {
      const updated = await apiFetch<ClientHandoff>(`/admin/client-operations/handoffs/${item.id}`, { method: "PATCH", body: patch })
      setHandoffs((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row)); setNotice("Client handoff updated.")
    } catch (cause) { setError(messageFor(cause, "The handoff could not be updated")) }
  }

  async function patchAppointment(item: ClientAppointment, patch: Record<string, unknown>) {
    try {
      const updated = await apiFetch<ClientAppointment>(`/admin/client-operations/appointments/${item.id}`, { method: "PATCH", body: patch })
      setAppointments((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row)); setNotice("Client appointment updated.")
    } catch (cause) { setError(messageFor(cause, "The appointment could not be updated")) }
  }

  async function patchSupport(item: SupportTicket, patch: Record<string, unknown>) {
    try {
      const updated = await apiFetch<SupportTicket>(`/support/admin/tickets/${item.id}`, { method: "PATCH", body: patch })
      setSupport((current) => current.map((row) => row.id === updated.id ? updated : row)); setNotice("Support request updated.")
    } catch (cause) { setError(messageFor(cause, "Support request could not be updated")) }
  }

  async function openClient(tenant: Tenant) {
    setSelectedTenant(tenant); setError("")
    try {
      const [users, status] = await Promise.all([
        apiFetch<TenantUser[]>(`/admin/tenants/${tenant.id}/users`),
        apiFetch<TenantReadiness>(`/admin/tenants/${tenant.id}/readiness`),
      ])
      setTenantUsers(users); setReadiness(status)
    } catch (cause) { setError(messageFor(cause, "Client details could not be loaded")) }
  }

  async function refreshReadiness() {
    if (!selectedTenant) return
    setReadiness(await apiFetch<TenantReadiness>(`/admin/tenants/${selectedTenant.id}/readiness`))
  }

  async function recordEvidence(patch: Record<string, unknown>) {
    if (!selectedTenant) return
    try {
      await apiFetch(`/admin/tenants/${selectedTenant.id}/onboarding-evidence`, { method: "POST", body: patch })
      await refreshReadiness(); setNotice("Onboarding evidence saved.")
    } catch (cause) { setError(messageFor(cause, "Evidence could not be saved")) }
  }

  async function assignClient(tenant: Tenant, assignedOperatorId: string) {
    try {
      const updated = await apiFetch<Tenant>(`/admin/tenants/${tenant.id}/assignment`, { method: "PATCH", body: { assignedOperatorId: assignedOperatorId || null } })
      setTenants((current) => current.map((row) => row.id === updated.id ? { ...row, assignedOperatorId: updated.assignedOperatorId } : row))
      setSelectedTenant((current) => current?.id === tenant.id ? { ...current, assignedOperatorId: updated.assignedOperatorId } : current)
    } catch (cause) { setError(messageFor(cause, "Client assignment could not be changed")) }
  }

  async function changeService(action: "activate" | "pause") {
    if (!selectedTenant) return
    try {
      await apiFetch(`/admin/tenants/${selectedTenant.id}/${action}`, { method: "POST" })
      await Promise.all([refreshReadiness(), loadAll()]); setNotice(action === "activate" ? "Client service activated." : "Client automations paused.")
    } catch (cause) { setError(messageFor(cause, `Client service could not be ${action}d`)); await refreshReadiness() }
  }

  async function setServiceSuspended(suspended: boolean) {
    if (!selectedTenant || !isOwner) return
    if (suspended && !window.confirm(`Stop all automated services for ${selectedTenant.name}? Leads and history will be preserved.`)) return
    try {
      await apiFetch(`/admin/tenants/${selectedTenant.id}/${suspended ? "suspend" : "restore"}`, {
        method: "POST",
        ...(suspended ? { body: { reason: "Services manually suspended by the RealtyTechAI platform owner." } } : {}),
      })
      await Promise.all([refreshReadiness(), loadAll()])
      setNotice(suspended ? "All client services stopped." : "Client services restored.")
    } catch (cause) {
      setError(messageFor(cause, suspended ? "Client services could not be stopped" : "Client services could not be restored"))
    }
  }

  async function impersonate(userId: string) {
    try {
      await apiFetch("/admin/impersonate", { method: "POST", body: { userId } }); window.location.assign("/app/dashboard")
    } catch (cause) { setError(messageFor(cause, "Client workspace could not be opened")) }
  }

  async function setStaffAccess(user: PlatformAccessUser, enabled: boolean) {
    try {
      const updated = await apiFetch<PlatformAccessUser>(`/admin/platform-access/${user.id}`, { method: "PATCH", body: { enabled } })
      setPlatformUsers((current) => current.map((row) => row.id === updated.id ? updated : row))
      await loadAll(); setNotice(enabled ? "Staff access enabled." : "Staff access removed.")
    } catch (cause) { setError(messageFor(cause, "Staff access could not be changed")) }
  }

  async function setPlatformAiPause(paused: boolean) {
    if (
      paused &&
      !window.confirm(
        "Pause every AI conversation on the platform and cancel queued AI replies? Manual RealtyTechAI access will remain available.",
      )
    ) {
      return
    }
    try {
      await apiFetch("/admin/ai/emergency-pause", {
        method: "POST",
        body: {
          paused,
          reason: paused
            ? "Platform emergency pause activated by the platform owner."
            : "",
        },
      })
      await loadAll()
      setNotice(
        paused
          ? "All AI activity paused."
          : "Platform pause cleared. Conversations remain paused until explicitly returned to AI.",
      )
    } catch (cause) {
      setError(messageFor(cause, "Platform AI pause could not be changed"))
    }
  }

  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground">Loading the RealtyTechAI operations workspace…</div>
  if (!me) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center" role="alert">
        <h1 className="text-xl font-semibold">Admin access unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">{accessError || "Platform owner or staff access is required."}</p>
        <Button className="mt-4" onClick={() => void loadAll()}>Try again</Button>
      </div>
    )
  }

  const urgentTasks = tasks.filter((item) => item.status !== "resolved" && ["high", "critical"].includes(item.priority))
  const urgentSupport = support.filter((item) => item.status !== "resolved" && ["high", "urgent"].includes(item.severity))
  const unassignedLeads = applications.filter((item) => !item.assignedOperatorId && !["accepted", "declined"].includes(item.status))
  const urgentClientLeads = leadAttention.filter((item) => item.readinessLevel === "urgent" || item.temperature === "hot")
  const canSuspendSelectedTenant = Boolean(selectedTenant && selectedTenant.lifecycleStatus === "ACTIVE" && selectedTenant.serviceState?.state !== "suspended")
  const canRestoreSelectedTenant = Boolean(selectedTenant && selectedTenant.lifecycleStatus !== "CANCELED" && selectedTenant.serviceState?.state === "suspended")
  const currentSectionFailures = viewDataSections[view].filter((section) => sectionErrors[section])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="text-sm font-medium text-primary">RealtyTechAI operations</div><h1 className="mt-1 text-3xl font-semibold tracking-tight">Know what needs attention next.</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Leads, client setup, service delivery, support, and billing are organized into one operating flow.</p></div>
        <div className="rounded-lg border bg-card px-4 py-3 text-sm"><div className="font-medium">Signed in as {me?.platformRole === "super_admin" ? "Owner" : "Staff"}</div><div className="text-xs text-muted-foreground">{me?.email}</div></div>
      </div>

      {error ? <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600"><span>{error}</span><Button size="sm" variant="ghost" onClick={() => setError("")}>Dismiss</Button></div> : null}
      {notice ? <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700"><span>{notice}</span><Button size="sm" variant="ghost" onClick={() => setNotice("")}>Dismiss</Button></div> : null}

      <div className="flex gap-2 overflow-x-auto border-b pb-2">
        {views.filter((item) => !item.ownerOnly || isOwner).map((item) => {
          const Icon = item.icon
          return <Button key={item.id} variant={view === item.id ? "default" : "ghost"} size="sm" className="shrink-0" onClick={() => switchView(item.id)}><Icon className="mr-2 h-4 w-4" />{item.label}</Button>
        })}
      </div>

      {currentSectionFailures.length ? (
        <SectionFailures
          sections={currentSectionFailures}
          errors={sectionErrors}
          loading={sectionLoading}
          onRetry={(section) => void loadDataSection(section).catch(() => undefined)}
        />
      ) : null}

      {view === "overview" ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Active clients" value={sectionErrors.overview ? null : overview?.active} detail={sectionErrors.overview ? "Summary unavailable" : `${overview?.onboarding ?? "—"} onboarding`} />
            <Metric label="New leads" value={sectionErrors.overview ? null : overview?.newApplications} detail={sectionErrors.overview ? "Summary unavailable" : "Awaiting review"} tone={overview?.newApplications ? "warning" : undefined} />
            <Metric label="Open tasks" value={sectionErrors.overview ? null : overview?.openTasks} detail={sectionErrors.overview ? "Summary unavailable" : `${overview?.urgentTasks ?? "—"} high priority`} tone={overview?.urgentTasks ? "warning" : undefined} />
            <Metric label="Open support" value={sectionErrors.overview ? null : overview?.openSupport} detail={sectionErrors.overview ? "Summary unavailable" : "Client requests"} tone={urgentSupport.length ? "warning" : undefined} />
          </div>
          <Card>
            <CardHeader><CardTitle>Action center</CardTitle><p className="text-sm text-muted-foreground">Start here. These are the items most likely to need you today.</p></CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-2">
              <Action title={sectionErrors.applications ? "Applications unavailable" : `${applications.filter((item) => item.status === "new").length} new application(s)`} detail="Review, qualify, book the call, then start client setup after close." button="Review leads" onClick={() => switchView("leads")} urgent={!sectionErrors.applications && applications.some((item) => item.status === "new")} />
              <Action title={sectionErrors.leadAttention ? "Client lead attention unavailable" : `${urgentClientLeads.length} urgent client lead(s)`} detail="Hot or urgent leads from active client workspaces that need human attention." button="Review client leads" onClick={() => switchView("leads")} urgent={!sectionErrors.leadAttention && urgentClientLeads.length > 0} />
              <Action title={sectionErrors.applications ? "Assignment queue unavailable" : `${unassignedLeads.length} unassigned lead(s)`} detail="Assign an owner so important follow-up does not sit in the shared queue." button="Assign leads" onClick={() => { switchView("leads"); setOwnerFilter("unassigned") }} urgent={!sectionErrors.applications && unassignedLeads.length > 0} />
              <Action title={sectionErrors.tasks ? "Operations tasks unavailable" : `${urgentTasks.length} high-priority task(s)`} detail="Includes onboarding blocks, failed payments, provider issues, and follow-up." button="Open tasks" onClick={() => switchView("tasks")} urgent={!sectionErrors.tasks && urgentTasks.length > 0} />
              <Action title={sectionErrors.support ? "Support queue unavailable" : `${urgentSupport.length} urgent support request(s)`} detail="Acknowledge, assign, and resolve client issues before their due time." button="Review support" onClick={() => switchView("support")} urgent={!sectionErrors.support && urgentSupport.length > 0} />
              <Action title={sectionErrors.handoffs ? "Client handoffs unavailable" : `${handoffs.filter((item) => item.status !== "completed").length} open client handoff(s)`} detail="See the same personal follow-ups currently shown to clients." button="Review handoffs" onClick={() => switchView("handoffs")} urgent={!sectionErrors.handoffs && handoffs.some((item) => item.priority === "urgent" && item.status !== "completed")} />
              <Action title={sectionErrors.appointments ? "Appointments unavailable" : `${appointments.filter((item) => ["scheduled", "confirmed"].includes(item.status)).length} upcoming appointment(s)`} detail="Confirm, reschedule, or close the loop for any client." button="Review appointments" onClick={() => switchView("appointments")} />
              <Action title={sectionErrors.clients ? "Client onboarding unavailable" : `${tenants.filter((item) => item.lifecycleStatus === "ONBOARDING").length} client(s) onboarding`} detail="See exactly what is missing and record launch evidence in one place." button="Review onboarding" onClick={() => switchView("onboarding")} />
              {isOwner ? <Action title={sectionErrors.overview ? "Past-due summary unavailable" : `${overview?.pastDue ?? 0} client(s) past due`} detail="Payment status is visible only to the owner." button="Review billing" onClick={() => switchView("billing")} urgent={!sectionErrors.overview && Boolean(overview?.pastDue)} /> : null}
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle>Business flow</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{["Lead received", "Call booked", "Client created", "Setup & testing", "Live & supported"].map((item, index) => <div key={item} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>{item}{index < 4 ? <ArrowRight className="ml-auto hidden h-4 w-4 text-muted-foreground lg:block" /> : null}</div>)}</CardContent></Card>
          <Card><CardHeader><CardTitle>Last 30 days</CardTitle><p className="text-sm text-muted-foreground">Real application, client, launch, and support records—no estimated data.</p></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><ReportValue label="Applications" value={sectionErrors.reporting ? null : report?.last30Days.applications} /><ReportValue label="Calls booked" value={sectionErrors.reporting ? null : report?.last30Days.consultations} /><ReportValue label="New clients" value={sectionErrors.reporting ? null : report?.last30Days.newClients} /><ReportValue label="Lead-to-client" value={sectionErrors.reporting ? null : report?.last30Days.conversionRate == null ? "Not enough data" : `${report.last30Days.conversionRate}%`} /><ReportValue label="Avg. time to launch" value={sectionErrors.reporting ? null : report?.last30Days.averageHoursToLaunch == null ? "Not enough data" : `${report.last30Days.averageHoursToLaunch} hours`} /></div>{sectionErrors.reporting ? <Empty text="Business reporting is unavailable. Retry it above." /> : <div><div className="mb-2 text-sm font-medium">Eight-week pipeline trend</div><div className="grid grid-cols-4 gap-2 sm:grid-cols-8">{report?.weekly.map((week) => <div key={week.start} className="rounded-lg border p-2 text-center"><div className="text-lg font-semibold">{week.applications}</div><div className="text-[10px] text-muted-foreground">leads</div><div className="mt-1 text-xs">{week.clients} client{week.clients === 1 ? "" : "s"}</div><div className="mt-1 text-[10px] text-muted-foreground">{new Date(week.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div></div>)}</div></div>}</CardContent></Card>
        </div>
      ) : null}

      {view === "leads" ? (
        <Section title="Leads" subtitle="Prospective client applications and urgent client leads are visible from one queue.">
          <Filters search={search} setSearch={setSearch} ownerFilter={ownerFilter} setOwnerFilter={setOwnerFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter} operators={operators} statuses={["new", "reviewing", "qualified", "consultation_booked", "accepted", "declined"]} />
          <div className="space-y-3">
            {filteredLeadAttention.map((item) => <Card key={item.id} className={item.readinessLevel === "urgent" || item.temperature === "hot" ? "border-amber-500/40" : ""}><CardContent className="space-y-3 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-lg font-medium">{item.fullName}</div><div className="text-sm text-muted-foreground">{item.tenant.name} · {label(item.stage)}</div></div><div className="flex gap-2"><Badge variant={item.readinessLevel === "urgent" ? "destructive" : "secondary"}>{label(item.readinessLevel)}</Badge><Badge variant={item.temperature === "hot" ? "destructive" : "outline"}>{item.temperature}</Badge></div></div><p className="text-sm">{item.recommendedNextAction || "Review this client lead and decide the next follow-up."}</p><Button size="sm" variant="outline" onClick={() => switchView("onboarding", item.tenant.id)}>Open client workspace</Button></CardContent></Card>)}
          </div>
          <div className="space-y-3">{filteredApplications.map((item) => <Card key={item.id}><CardContent className="space-y-4 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-lg font-medium">{item.company || item.name}</div><div className="text-sm text-muted-foreground">{item.email} · {item.phone || "No phone"} · {label(item.status)}</div></div><Badge variant={item.notificationStatus === "failed" ? "destructive" : "secondary"}>{item.notificationStatus === "failed" ? "Saved—email alert failed" : `Alert ${item.notificationStatus}`}</Badge></div><p className="text-sm">{item.message}</p><div className="grid gap-3 md:grid-cols-3"><label className="space-y-1 text-xs font-medium">Stage<select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={item.status} onChange={(event) => void patchApplication(item, { status: event.target.value, operatorNotes: notes[item.id] || "", assignedOperatorId: item.assignedOperatorId || null })}>{["new", "reviewing", "qualified", "consultation_booked", "accepted", "declined"].map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label><OwnerSelect value={item.assignedOperatorId || ""} operators={operators} onChange={(value) => void patchApplication(item, { assignedOperatorId: value || null, operatorNotes: notes[item.id] || "" })} /><label className="space-y-1 text-xs font-medium">Internal notes<Input value={notes[item.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} onBlur={() => { if ((notes[item.id] || "") !== (item.operatorNotes || "")) void patchApplication(item, { operatorNotes: notes[item.id] || "" }) }} /></label></div><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => prepareClient(item)} disabled={!isOwner || item.status === "declined"}><UserPlus className="mr-2 h-4 w-4" />Start client setup</Button><Button size="sm" variant="outline" onClick={() => void apiFetch(`/admin/applications/${item.id}/onboarding-task`, { method: "POST" }).then(loadAll)}>Create follow-up task</Button></div></CardContent></Card>)}{!sectionErrors.applications && !filteredApplications.length ? <Empty text="No leads match these filters." /> : null}</div>
        </Section>
      ) : null}

      {view === "clients" ? (
        <div className="space-y-6">
          {isOwner ? <Card className={sourceApplicationId ? "border-primary/40" : ""}><CardHeader><CardTitle>{sourceApplicationId ? "Turn this closed lead into a client" : "Add a client after you close them"}</CardTitle><p className="text-sm text-muted-foreground">This creates a private, inactive workspace. The client completes intake and connects their own accounts before you activate service.</p></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-[1fr_1fr_220px_auto] md:items-end" onSubmit={createClient}><FieldLabel label="Business name"><Input required minLength={2} maxLength={120} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></FieldLabel><FieldLabel label="Owner email"><Input required type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /></FieldLabel><OwnerSelect value={newClientOwner} operators={operators} onChange={setNewClientOwner} /><Button disabled={creatingClient}>{creatingClient ? "Creating…" : "Create client"}</Button></form></CardContent></Card> : null}
          {clientSetup ? <Card className="border-emerald-500/40"><CardHeader><CardTitle>Client handoff is ready</CardTitle><p className="text-sm text-muted-foreground">Do these three things: send the verification link, send the temporary password through a different channel, then ask the client to complete Get started and Connections.</p></CardHeader><CardContent className="space-y-3"><CopyRow label="Owner email" value={clientSetup.owner.email} /><CopyRow label="Temporary password" value={clientSetup.temporaryPassword} /><CopyRow label="Verification link" value={clientSetup.verifyLink} /><p className="rounded-md bg-muted p-3 text-sm">{clientSetup.verificationEmailSent ? "Verification email sent successfully." : "System email is not connected, so send the verification link manually."}</p><Button variant="outline" onClick={() => setClientSetup(null)}>I saved the handoff</Button></CardContent></Card> : null}
          <Section title="Clients" subtitle="Service status and ownership at a glance."><Filters search={search} setSearch={setSearch} ownerFilter={ownerFilter} setOwnerFilter={setOwnerFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter} operators={operators} statuses={["ONBOARDING", "READY_FOR_UAT", "UAT_FAILED", "READY_FOR_ACTIVATION", "ACTIVE", "PAUSED", "SUSPENDED", "CANCELED"]} /><div className="grid gap-3 md:grid-cols-2">{filteredTenants.map((tenant) => <Card key={tenant.id}><CardContent className="space-y-3 p-5"><div className="flex items-start justify-between gap-3"><div><div className="font-medium">{tenant.name}</div><div className="text-sm text-muted-foreground">{label(tenant.lifecycleStatus)}</div></div><Badge variant={tenant.lifecycleStatus === "ACTIVE" ? "default" : "secondary"}>{label(tenant.lifecycleStatus)}</Badge></div><div className="text-xs text-muted-foreground">Owner: {operatorName(tenant.assignedOperatorId)}</div>{isOwner ? <OwnerSelect value={tenant.assignedOperatorId || ""} operators={operators} onChange={(value) => void assignClient(tenant, value)} /> : null}<Button variant="outline" className="w-full" onClick={() => { void openClient(tenant); switchView("onboarding", tenant.id) }}>Open client workspace</Button></CardContent></Card>)}{!sectionErrors.clients && !filteredTenants.length ? <Empty text="No clients match these filters." /> : null}</div></Section>
        </div>
      ) : null}

      {view === "handoffs" ? <Section title="Client handoffs" subtitle="The same human follow-ups clients see on Today, with operator oversight and completion state."><div className="grid gap-2 md:grid-cols-[1fr_240px]"><Input placeholder="Search client, lead, or reason" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="h-10 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{["open", "opened", "snoozed", "completed"].map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div><div className="space-y-3">{filteredHandoffs.map((item) => <Card key={item.id}><CardContent className="space-y-3 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-medium">{item.lead.fullName} · {item.tenant.name}</div><div className="text-xs text-muted-foreground">{label(item.lead.leadType)} · {label(item.lead.temperature)} · due {item.dueAt ? new Date(item.dueAt).toLocaleString() : "not set"}</div></div><div className="flex gap-2"><Badge variant={item.priority === "urgent" ? "destructive" : "secondary"}>{item.priority}</Badge><Badge variant="outline">{label(item.status)}</Badge></div></div><p className="text-sm">{item.summary}</p><div className="rounded-md bg-muted p-3 text-sm"><span className="font-medium">Why:</span> {item.reason}<br /><span className="font-medium">Next:</span> {item.recommendedAction}</div>{item.status !== "completed" ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void patchHandoff(item, { action: "opened" })}>Mark opened</Button><Button size="sm" onClick={() => void patchHandoff(item, { action: "completed", note: "Completed with operator assistance" })}>Mark completed</Button><Button size="sm" variant="ghost" onClick={() => void patchHandoff(item, { action: "snoozed", snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), note: "Snoozed by operator" })}>Snooze one day</Button></div> : null}</CardContent></Card>)}{!sectionErrors.handoffs && !filteredHandoffs.length ? <Empty text="No handoffs match these filters." /> : null}</div></Section> : null}

      {view === "appointments" ? <Section title="Client appointments" subtitle="One appointment record powers both the client workspace and this operational view."><div className="grid gap-2 md:grid-cols-[1fr_240px]"><Input placeholder="Search client or lead" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="h-10 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{["scheduled", "confirmed", "completed", "cancelled", "no_show"].map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div><div className="space-y-3">{filteredAppointments.map((item) => <Card key={item.id}><CardContent className="space-y-3 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-medium">{item.lead.fullName} · {item.tenant.name}</div><div className="text-sm text-muted-foreground">{new Date(item.startsAt).toLocaleString()} · {item.calendarSource}</div></div><div className="flex gap-2"><Badge variant={item.confirmationStatus === "confirmed" ? "default" : "secondary"}>{label(item.confirmationStatus)}</Badge><Badge variant="outline">{label(item.status)}</Badge></div></div>{item.notes ? <p className="text-sm">{item.notes}</p> : null}<div className="flex flex-wrap gap-2">{item.status === "scheduled" ? <Button size="sm" onClick={() => void patchAppointment(item, { status: "confirmed", confirmationStatus: "confirmed" })}>Confirm</Button> : null}{["scheduled", "confirmed"].includes(item.status) ? <Button size="sm" variant="outline" onClick={() => void patchAppointment(item, { status: "completed", followUpStatus: "due" })}>Mark completed</Button> : null}{["scheduled", "confirmed"].includes(item.status) ? <Button size="sm" variant="ghost" onClick={() => void patchAppointment(item, { status: "cancelled" })}>Cancel</Button> : null}</div></CardContent></Card>)}{!sectionErrors.appointments && !filteredAppointments.length ? <Empty text="No appointments match these filters." /> : null}</div></Section> : null}

      {view === "onboarding" ? (
        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <Card><CardHeader><CardTitle>Clients onboarding</CardTitle><p className="text-sm text-muted-foreground">Choose a client to see exactly what remains.</p></CardHeader><CardContent className="space-y-2">{tenants.filter((tenant) => tenant.lifecycleStatus !== "CANCELED").map((tenant) => <button type="button" key={tenant.id} onClick={() => switchView("onboarding", tenant.id)} className={`w-full rounded-lg border p-3 text-left hover:bg-muted/50 ${selectedTenant?.id === tenant.id ? "border-primary bg-primary/5" : ""}`}><div className="font-medium">{tenant.name}</div><div className="mt-1 text-xs text-muted-foreground">{label(tenant.lifecycleStatus)} · {operatorName(tenant.assignedOperatorId)}</div></button>)}</CardContent></Card>
          <Card><CardHeader><CardTitle>{selectedTenant?.name || "Select a client"}</CardTitle>{selectedTenant ? <p className="text-sm text-muted-foreground">{readiness?.ready ? "All required checks pass. The owner can activate service." : `${readiness?.blockers.length || 0} required check(s) remain.`}</p> : null}</CardHeader><CardContent className="space-y-5">{selectedTenant ? <><div className="grid gap-2 sm:grid-cols-2">{readiness?.required.map((item) => <div key={item.key} className="flex gap-2 rounded-lg border p-3 text-sm">{item.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />}<span>{item.label}</span></div>)}</div><div className="rounded-lg border p-4"><div className="font-medium">Record your review</div><p className="mt-1 text-sm text-muted-foreground">Run the real controlled lead journey before marking the test complete.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><Button variant="outline" onClick={() => void recordEvidence({ providerRejectionTestedAt: new Date().toISOString() })}>Failure visibility tested</Button><Button variant="outline" onClick={() => void recordEvidence({ billingVerifiedAt: new Date().toISOString() })} disabled={!isOwner}>Billing verified</Button><Button variant="outline" onClick={() => void recordEvidence({ operatorApproved: true })}>Operator review approved</Button></div><div className="mt-3 flex gap-2"><Input placeholder="Reference the client's written launch approval" value={evidence[selectedTenant.id] || ""} onChange={(event) => setEvidence((current) => ({ ...current, [selectedTenant.id]: event.target.value }))} /><Button variant="outline" disabled={!evidence[selectedTenant.id]?.trim()} onClick={() => void recordEvidence({ clientApprovedAt: new Date().toISOString(), clientApprovalEvidence: evidence[selectedTenant.id].trim() })}>Save approval</Button></div></div>{isOwner ? <div className="flex flex-wrap gap-2"><Button disabled={!readiness?.ready} onClick={() => void changeService("activate")}>Activate service</Button><Button variant="outline" onClick={() => void changeService("pause")}>Pause automations</Button>{canRestoreSelectedTenant ? <Button variant="outline" onClick={() => void setServiceSuspended(false)}>Restore all services</Button> : null}{canSuspendSelectedTenant ? <Button variant="destructive" onClick={() => void setServiceSuspended(true)}>Stop all services</Button> : null}</div> : null}<div><div className="mb-2 font-medium">Client users</div><div className="space-y-2">{tenantUsers.map((user) => <div key={user.id} className="flex items-center justify-between rounded-lg border p-3"><div><div className="text-sm font-medium">{user.email}</div><div className="text-xs text-muted-foreground">{user.role} · {user.isActive ? "active" : "inactive"}</div></div>{isOwner ? <Button size="sm" variant="outline" disabled={!user.isActive} onClick={() => void impersonate(user.id)}>View as client</Button> : null}</div>)}</div></div></> : <Empty text="Choose a client from the list to manage onboarding." />}</CardContent></Card>
        </div>
      ) : null}

      {view === "tasks" ? <Section title="Operations tasks" subtitle="Assign work, record evidence, and keep blocked items visible."><Filters search={search} setSearch={setSearch} ownerFilter={ownerFilter} setOwnerFilter={setOwnerFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter} operators={operators} statuses={["open", "in_progress", "blocked", "resolved"]} /><div className="space-y-3">{filteredTasks.map((item) => <Card key={item.id}><CardContent className="space-y-3 p-5"><div className="flex items-start justify-between gap-3"><div><div className="font-medium">{item.title}</div><div className="text-xs text-muted-foreground">{label(item.category)} · due {item.dueAt ? new Date(item.dueAt).toLocaleString() : "not set"}</div></div><Badge variant={item.priority === "critical" ? "destructive" : "secondary"}>{item.priority}</Badge></div><p className="text-sm text-muted-foreground">{item.description}</p><div className="grid gap-3 md:grid-cols-3"><OwnerSelect value={item.assignedOperatorId || ""} operators={operators} onChange={(value) => void patchTask(item, { assignedOperatorId: value || null })} /><FieldLabel label="Due date"><Input type="datetime-local" value={item.dueAt ? item.dueAt.slice(0, 16) : ""} onChange={(event) => void patchTask(item, { dueAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></FieldLabel><FieldLabel label="Evidence / resolution"><Input value={evidence[item.id] ?? item.evidenceNote ?? ""} onChange={(event) => setEvidence((current) => ({ ...current, [item.id]: event.target.value }))} /></FieldLabel></div><div className="flex flex-wrap gap-2">{(["open", "in_progress", "blocked", "resolved"] as const).map((status) => <Button key={status} size="sm" variant={item.status === status ? "default" : "outline"} onClick={() => void patchTask(item, { status, evidenceNote: evidence[item.id] ?? item.evidenceNote ?? null })}>{label(status)}</Button>)}</div></CardContent></Card>)}{!sectionErrors.tasks && !filteredTasks.length ? <Empty text="No tasks match these filters." /> : null}</div></Section> : null}

      {view === "support" ? <Section title="Client support" subtitle="Acknowledge urgent requests quickly, assign an owner, and document the resolution."><div className="space-y-3">{support.map((item) => <Card key={item.id}><CardContent className="space-y-3 p-5"><div className="flex items-start justify-between gap-3"><div><div className="font-medium">{item.subject}</div><div className="text-xs text-muted-foreground">{item.email} · due {item.dueAt ? new Date(item.dueAt).toLocaleString() : "not set"}</div></div><Badge variant={item.severity === "urgent" ? "destructive" : "secondary"}>{item.severity}</Badge></div><p className="text-sm">{item.message}</p><div className="grid gap-3 md:grid-cols-2"><OwnerSelect value={item.assignedOperatorId || ""} operators={operators} onChange={(value) => void patchSupport(item, { assignedOperatorId: value || null })} /><FieldLabel label="Resolution note"><Input value={evidence[item.id] ?? item.resolutionNote ?? ""} onChange={(event) => setEvidence((current) => ({ ...current, [item.id]: event.target.value }))} /></FieldLabel></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void patchSupport(item, { status: "acknowledged" })}>Acknowledge</Button><Button size="sm" onClick={() => void patchSupport(item, { status: "resolved", resolutionNote: evidence[item.id] ?? item.resolutionNote ?? "Resolved by operator" })}>Resolve</Button></div></CardContent></Card>)}{!sectionErrors.support && !support.length ? <Empty text="No support requests." /> : null}</div></Section> : null}

      {view === "ai" ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="AI-enabled clients" value={sectionErrors.ai ? null : aiOverview?.aiEnabledClients} detail={sectionErrors.ai ? "AI data unavailable" : "Approved and enabled"} />
            <Metric label="AI conversations" value={sectionErrors.ai ? null : aiOverview?.activeAiConversations} detail={sectionErrors.ai ? "AI data unavailable" : `${aiOverview?.humanTakeovers ?? "—"} human takeover(s) · ${aiOverview?.humanControlledConversations ?? "—"} human-controlled`} />
            <Metric label="Waiting for human" value={sectionErrors.ai ? null : aiOverview?.waitingForHuman} detail={sectionErrors.ai ? "AI data unavailable" : "Escalated conversations"} tone={aiOverview?.waitingForHuman ? "warning" : undefined} />
            <Metric label="Blocked or failed" value={sectionErrors.ai || !aiOverview ? null : aiOverview.blockedRuns + aiOverview.failedRuns} detail={sectionErrors.ai ? "AI data unavailable" : `${aiOverview?.usageLimitViolations ?? "—"} usage-limit block(s)`} tone={aiOverview && aiOverview.blockedRuns + aiOverview.failedRuns ? "warning" : undefined} />
          </div>
          <Card className={aiOverview?.platformPaused ? "border-red-500/40" : ""}>
            <CardHeader><CardTitle className="flex items-center gap-2"><PauseCircle className="h-5 w-5" />Platform AI control</CardTitle><p className="text-sm text-muted-foreground">This kill switch stops AI generation and queued AI sends without disabling inboxes, manual messaging, leads, or appointments.</p></CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-4"><div><Badge variant={aiOverview?.platformPaused ? "destructive" : "outline"}>{sectionErrors.ai || !aiOverview ? "AI status unavailable" : aiOverview.platformPaused ? "All AI paused" : "AI platform available"}</Badge>{aiOverview?.platformPauseReason ? <p className="mt-2 text-sm text-muted-foreground">{aiOverview.platformPauseReason}</p> : null}</div>{isOwner && aiOverview && !sectionErrors.ai ? <Button variant={aiOverview.platformPaused ? "outline" : "destructive"} onClick={() => void setPlatformAiPause(!aiOverview.platformPaused)}>{aiOverview.platformPaused ? "Clear platform pause" : "Pause all AI"}</Button> : !isOwner ? <p className="text-sm text-muted-foreground">Only the platform owner can change the global pause.</p> : null}</CardContent>
          </Card>
          <Section title="Client AI status" subtitle="Operational settings and aggregate usage only. Tenant conversation content is not exposed here.">
            <div className="space-y-2">
              {aiOverview?.clients.map((client) => {
                const percent = Math.min(Math.round((client.usage / Math.max(client.monthlyUsageLimit, 1)) * 100), 100)
                return <div key={client.tenantId} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_auto_auto] md:items-center"><div><div className="font-medium">{client.tenantName}</div><div className="text-xs text-muted-foreground">{label(client.mode)} · configuration {label(client.configurationApprovalStatus)}</div></div><Badge variant={client.aiEnabled && !client.aiPaused ? "default" : "secondary"}>{client.aiEnabled && !client.aiPaused ? "Active" : "Paused"}</Badge><div className="text-sm text-muted-foreground md:text-right">{percent}% of limit{client.estimatedCostUsd ? ` · ${client.estimatedCostUsd.toLocaleString(undefined, { style: "currency", currency: "USD" })} estimated` : ""}</div></div>
              })}
              {!sectionErrors.ai && !aiOverview?.clients.length ? <Empty text="No client AI configuration exists yet." /> : null}
            </div>
          </Section>
        </div>
      ) : null}

      {view === "integrations" ? <ManagedIntegrations /> : null}

      {view === "activity" ? <div className="grid gap-5 xl:grid-cols-2"><Section title="Connection status" subtitle="Operational status only—credentials and secrets never reach this page."><div className="space-y-2">{connections.map((item) => <div key={`${item.tenantId}-${item.provider}`} className="flex items-center justify-between rounded-lg border p-3"><div><div className="text-sm font-medium">{item.tenantName}</div><div className="text-xs text-muted-foreground">{label(item.provider)} · updated {new Date(item.updatedAt).toLocaleString()}</div></div><Badge>{item.status}</Badge></div>)}{!sectionErrors.integrations && !connections.length ? <Empty text="No client connections have been saved yet." /> : null}</div></Section><Section title="Communications history" subtitle="Read-only delivery history. Sending and replies remain inside the client workspace."><div className="space-y-2">{communications.map((item) => <div key={item.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><div className="text-sm font-medium">{item.leadName}</div><Badge variant="secondary">{item.channel} · {item.status}</Badge></div><p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{item.body}</p><div className="mt-2 text-xs text-muted-foreground">{item.direction} · {new Date(item.createdAt).toLocaleString()}</div></div>)}{!sectionErrors.communications && !communications.length ? <Empty text="No communications yet." /> : null}</div></Section></div> : null}

      {view === "billing" && isOwner ? <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Monthly recurring revenue" value={!sectionErrors.billing && billing ? currency(billing.mrrByCurrency?.usd ?? 0) : null} detail={sectionErrors.billing ? "Billing data unavailable" : "Live active subscriptions"} /><Metric label="Collected this month" value={!sectionErrors.billing && billing ? currency(billing.live.collectedThisMonth.find((row) => row.currency === "usd")?.amountCents ?? 0) : null} detail={sectionErrors.billing ? "Billing data unavailable" : "Live payments minus refunds"} /><Metric label="Collected this year" value={!sectionErrors.billing && billing ? currency(billing.live.collectedThisYear.find((row) => row.currency === "usd")?.amountCents ?? 0) : null} detail={sectionErrors.billing ? "Billing data unavailable" : "Live payments minus refunds"} /><Metric label="Past due clients" value={!sectionErrors.billing ? billing?.pastDueClients ?? null : null} detail={sectionErrors.billing ? "Billing data unavailable" : "Needs billing follow-up"} tone={!sectionErrors.billing && billing?.pastDueClients ? "warning" : undefined} /></div><Card><CardHeader><CardTitle>System and provider readiness</CardTitle><p className="text-sm text-muted-foreground">No secrets are shown. Test Stripe data is kept separate from live revenue.</p></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Health label="Database" value={sectionErrors.health || !health ? "Unavailable" : health.dbConnected ? "Healthy" : "Unavailable"} good={Boolean(!sectionErrors.health && health?.dbConnected)} /><Health label="Messages (24h)" value={!sectionErrors.health && health ? `${health.failedMessages24h} failed / ${health.totalMessages24h} total` : "Unavailable"} good={Boolean(!sectionErrors.health && health && !health.failedMessages24h)} /><Health label="Phone push" value={!sectionErrors.health && health ? label(health.environment?.devicePush?.status) : "Unavailable"} good={!sectionErrors.health && health?.environment?.devicePush?.status === "up"} /><Health label="System email" value={!sectionErrors.health && health ? label(health.environment?.systemEmail?.status) : "Unavailable"} good={!sectionErrors.health && health?.environment?.systemEmail?.status === "up"} /><Health label="Stripe" value={!sectionErrors.health && health ? label(health.environment?.billing?.status) : "Unavailable"} good={!sectionErrors.health && health?.environment?.billing?.status === "up"} /><Health label="Retention" value={!sectionErrors.health && health?.environment?.retention?.days != null ? `${health.environment.retention.days} days · daily` : "Unavailable"} good={Boolean(!sectionErrors.health && health?.environment?.retention?.days)} /></CardContent></Card><Card><CardHeader><CardTitle>Admin access</CardTitle><p className="text-sm text-muted-foreground">Staff can work leads, clients, onboarding, tasks, support, and read-only activity. They cannot see revenue, system health, raw webhooks, activation, impersonation, or access controls.</p></CardHeader><CardContent className="space-y-2">{!sectionErrors.access ? platformUsers.map((user) => <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="text-sm font-medium">{user.email}</div><div className="text-xs text-muted-foreground">{user.platformRole ? label(user.platformRole) : "Client workspace user"} · {user.isEmailVerified ? "verified" : "not verified"}</div></div>{user.platformRole === "super_admin" ? <Badge>Owner</Badge> : user.accessManagedByEnvironment ? <Badge variant="secondary">Environment staff</Badge> : <Button size="sm" variant={user.platformRole === "staff" ? "outline" : "default"} disabled={!user.isActive || !user.isEmailVerified} onClick={() => void setStaffAccess(user, user.platformRole !== "staff")}>{user.platformRole === "staff" ? "Remove staff access" : "Make staff"}</Button>}</div>) : null}</CardContent></Card>{!sectionErrors.billing && billing?.test.collectedThisMonth.length ? <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">Stripe test-mode activity this month: {billing.test.collectedThisMonth.map((row) => `${currency(row.amountCents, row.currency)} ${row.currency.toUpperCase()}`).join(", ")}. It is not included in live revenue.</div> : null}</div> : null}
      {view === "billing" && isOwner && billing && !sectionErrors.billing ? <BillingActivity billing={billing} /> : null}
    </div>
  )
}

function BillingActivity({ billing }: { billing: BillingOverview }) {
  const counts = billing.live.eventCounts30 || {}
  const events = billing.live.recentEvents || []
  const subscriptions = billing.subscriptionCounts || { active: 0, trialing: 0, pastDue: 0, canceled: 0 }
  const renewals = billing.upcomingRenewals || []
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Live Stripe activity</CardTitle>
          <p className="text-sm text-muted-foreground">Verified live-mode webhooks from the last 30 days. Test events stay separate.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ReportValue label="Paid" value={counts.invoice_paid || 0} />
            <ReportValue label="Failed" value={counts.payment_failed || 0} />
            <ReportValue label="Refunds" value={counts.refund || 0} />
            <ReportValue label="Disputes" value={counts.dispute || 0} />
          </div>
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{event.tenantName}</div>
                  <div className="text-xs text-muted-foreground">{label(event.eventType)} · {new Date(event.occurredAt).toLocaleString()}</div>
                </div>
                <div className="text-sm font-medium">
                  {Number(event.amountCents) > 0 ? currency(event.amountCents, event.currency) : "Status update"}
                </div>
              </div>
            ))}
            {!events.length ? <Empty text="No live billing events in the last 30 days." /> : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Subscriptions and renewals</CardTitle>
          <p className="text-sm text-muted-foreground">Current synchronized subscription state—no browser-supplied billing data.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ReportValue label="Active" value={subscriptions.active} />
            <ReportValue label="Trialing" value={subscriptions.trialing} />
            <ReportValue label="Past due" value={subscriptions.pastDue} />
            <ReportValue label="Canceled" value={subscriptions.canceled} />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Renewing in the next 30 days</div>
            <div className="space-y-2">
              {renewals.map((renewal) => (
                <div key={renewal.tenantId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">{renewal.tenantName}</div>
                    <div className="text-xs text-muted-foreground">{new Date(renewal.renewsAt).toLocaleDateString()}</div>
                  </div>
                  <div className="text-sm font-medium">
                    {renewal.amountCents != null && renewal.currency ? currency(renewal.amountCents, renewal.currency) : "Amount unavailable"}
                  </div>
                </div>
              ))}
              {!renewals.length ? <Empty text="No renewals are due in the next 30 days." /> : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SectionFailures({
  sections,
  errors,
  loading,
  onRetry,
}: {
  sections: DataSection[]
  errors: Partial<Record<DataSection, string>>
  loading: Partial<Record<DataSection, boolean>>
  onRetry: (section: DataSection) => void
}) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4" role="alert">
      <div className="font-medium">Some live data is temporarily unavailable.</div>
      <p className="text-sm text-muted-foreground">Available sections remain usable. Retry only the affected data below.</p>
      <div className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <Button
            key={section}
            size="sm"
            variant="outline"
            disabled={Boolean(loading[section])}
            title={errors[section]}
            onClick={() => onRetry(section)}
          >
            {loading[section] ? "Retrying…" : `Retry ${dataSectionLabels[section]}`}
          </Button>
        ))}
      </div>
    </div>
  )
}

function Metric({ label: title, value, detail, tone }: { label: string; value?: string | number | null; detail: string; tone?: "warning" }) {
  return <Card className={tone === "warning" ? "border-amber-500/40" : ""}><CardContent className="p-5"><div className="text-sm text-muted-foreground">{title}</div><div className="mt-2 text-3xl font-semibold">{value ?? "—"}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></CardContent></Card>
}

function Action({ title, detail, button, onClick, urgent }: { title: string; detail: string; button: string; onClick: () => void; urgent?: boolean }) {
  return <div className={`rounded-lg border p-4 ${urgent ? "border-amber-500/40 bg-amber-500/5" : ""}`}><div className="font-medium">{title}</div><p className="mt-1 text-sm text-muted-foreground">{detail}</p><Button className="mt-3" size="sm" variant={urgent ? "default" : "outline"} onClick={onClick}>{button}<ArrowRight className="ml-2 h-4 w-4" /></Button></div>
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle><p className="text-sm text-muted-foreground">{subtitle}</p></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>
}

function Filters({ search, setSearch, ownerFilter, setOwnerFilter, statusFilter, setStatusFilter, operators, statuses }: { search: string; setSearch: (value: string) => void; ownerFilter: string; setOwnerFilter: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; operators: Operator[]; statuses: string[] }) {
  return <div className="grid gap-2 md:grid-cols-[1fr_220px_220px]"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select className="h-10 rounded-md border bg-background px-3 text-sm" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">All owners</option><option value="unassigned">Unassigned</option>{operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.email}</option>)}</select><select className="h-10 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>
}

function OwnerSelect({ value, operators, onChange }: { value: string; operators: Operator[]; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-xs font-medium">Assigned owner<select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Unassigned</option>{operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.email}</option>)}</select></label>
}

function FieldLabel({ label: title, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 text-xs font-medium">{title}{children}</label>
}

function CopyRow({ label: title, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return <div><div className="text-xs font-medium">{title}</div><div className="mt-1 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{value}</code><Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) })}>{copied ? "Copied" : "Copy"}</Button></div></div>
}

function Health({ label: title, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="rounded-lg border p-4"><div className="flex items-center gap-2 text-sm font-medium"><span className={`h-2.5 w-2.5 rounded-full ${good ? "bg-emerald-500" : "bg-amber-500"}`} />{title}</div><div className="mt-2 text-sm text-muted-foreground">{value}</div></div>
}

function ReportValue({ label: title, value }: { label: string; value?: string | number | null }) {
  return <div className="rounded-lg bg-muted p-3"><div className="text-xs text-muted-foreground">{title}</div><div className="mt-1 text-lg font-semibold">{value ?? "—"}</div></div>
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>
}
