"use client"

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  MoreHorizontal,
  Plus,
  Search,
  ShieldAlert,
  UserPlus,
} from "lucide-react"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAdminSession } from "@/app/admin/admin-access-guard"
import { NotificationCenter } from "@/components/admin/notification-center"
import { ServiceControlDialog } from "@/components/admin/service-control-dialog"
import { secondaryAdminNavigation, type AdminView } from "@/components/admin/admin-navigation"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const ManagedIntegrations = dynamic(() => import("@/components/admin/managed-integrations"), {
  loading: () => <LoadingTable />,
})
const SalesBookingSettings = dynamic(() => import("@/components/admin/sales-booking-settings"), {
  loading: () => <LoadingTable />,
})

type ClientTab = "overview" | "leads" | "conversations" | "appointments" | "setup" | "billing" | "activity"

type Overview = {
  totalClients: number
  active: number
  onboarding: number
  newApplications: number
  openTasks: number
  urgentTasks: number
  openSupport: number
  trialing?: number
  pastDue?: number
  canceled?: number
}

type BillingOverview = {
  mrrByCurrency: Record<string, number>
  live: {
    collectedThisMonth: Array<{ currency: string; amountCents: string }>
    collectedThisYear: Array<{ currency: string; amountCents: string }>
    eventCounts30: Record<string, number>
    recentEvents: Array<{
      id: string
      tenantId?: string | null
      tenantName: string
      eventType: string
      amountCents: string | number
      currency: string
      occurredAt: string
    }>
  }
  test: { collectedThisMonth: Array<{ currency: string; amountCents: string }> }
  subscriptionCounts: { active: number; trialing: number; pastDue: number; canceled: number }
  upcomingRenewals: Array<{
    tenantId: string
    tenantName: string
    renewsAt: string
    amountCents?: number | null
    currency?: string | null
  }>
  pastDueClients: number
}

type SystemHealth = {
  totalMessages24h: number
  failedMessages24h: number
  dbConnected: boolean
  environment?: {
    devicePush?: { status: string }
    billing?: { status: string }
    systemEmail?: { status: string }
    retention?: { days: number }
  }
}

type SetupChecker = {
  ready: boolean
  groups: Record<
    string,
    Array<{
      label: string
      status: "ready" | "action_required"
      nextAction?: string | null
      detail?: unknown
    }>
  >
}

type OwnerExceptions = {
  status: "HEALTHY" | "ACTION REQUIRED"
  action: "NO ACTION" | "REVIEW EXCEPTIONS"
  exceptions: Array<{
    id: string
    tenantId?: string | null
    severity: string
    category: string
    problem: string
    providerError?: string | null
    automaticAttempts: Array<{
      operation: string
      attempts: number
      maxAttempts: number
      status: string
      lastError?: string | null
      lastChecked: string
    }>
    recommendedAction: string
    firstDetected: string
    lastChecked: string
    status: string
  }>
}

type Operator = { id: string; email: string; platformRole: "super_admin" | "staff" }

type PlatformAccessUser = {
  id: string
  email: string
  isActive: boolean
  isEmailVerified: boolean
  platformRole: "super_admin" | "staff" | null
  accessManagedByEnvironment: boolean
}

type Tenant = {
  id: string
  name: string
  status?: string
  lifecycleStatus: string
  assignedOperatorId?: string | null
  serviceState?: { state: string; label: string; reason: string; graceEndsAt?: string | null }
  serviceSuspendedAt?: string | null
  serviceSuspensionReason?: string | null
  serviceSuspensionSource?: string | null
  serviceSuspendedById?: string | null
  serviceRestoredAt?: string | null
  serviceRestoredById?: string | null
  currentPeriodEnd?: string | null
  lastPaymentFailureAt?: string | null
  createdAt: string
  updatedAt: string
}

type ProspectApplication = {
  id: string
  name: string
  email: string
  company?: string | null
  phone?: string | null
  website?: string | null
  estimatedMonthlyLeadVolume?: number | null
  requestedService?: string | null
  message: string
  source: string
  status: string
  assignedOperatorId?: string | null
  operatorNotes?: string | null
  notificationStatus: string
  createdAt: string
  updatedAt: string
}

type OperationsTask = {
  id: string
  tenantId?: string | null
  category: string
  title: string
  description: string
  priority: "low" | "normal" | "high" | "critical"
  status: "open" | "in_progress" | "blocked" | "resolved"
  assignedOperatorId?: string | null
  dueAt?: string | null
  evidenceNote?: string | null
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  createdAt: string
  updatedAt: string
}

type SupportTicket = {
  id: string
  tenantId: string
  email: string
  subject: string
  message: string
  category?: string | null
  status: "open" | "acknowledged" | "resolved" | "closed"
  severity: "low" | "normal" | "high" | "urgent"
  assignedOperatorId?: string | null
  dueAt?: string | null
  resolutionNote?: string | null
  createdAt: string
  updatedAt: string
}

type Communication = {
  id: string
  tenantId: string
  leadId: string
  leadName: string
  channel: string
  direction: string
  body: string
  status: string
  providerStatus?: string | null
  createdAt: string
}

type LeadAttention = {
  id: string
  fullName: string
  stage: string
  source?: string | null
  communicationStatus?: string | null
  lastContactedAt?: string | null
  nextFollowUpAt?: string | null
  assignedTo?: string | null
  temperature: "hot" | "warm" | "cold"
  readinessLevel: "not_ready" | "exploring" | "ready" | "urgent"
  recommendedNextAction?: string | null
  createdAt: string
  tenant: { id: string; name: string }
}

type Connection = {
  tenantId: string
  tenantName: string
  provider: string
  status: string
  needsAttention?: boolean
  updatedAt: string
}

type ClientHandoff = {
  id: string
  tenantId: string
  priority: "normal" | "high" | "urgent"
  status: "open" | "opened" | "snoozed" | "completed"
  reason: string
  summary: string
  recommendedAction: string
  dueAt?: string | null
  completionNote?: string | null
  tenant: { id: string; name: string }
  lead: { id: string; fullName: string; leadType: string; temperature: string }
}

type ClientAppointment = {
  id: string
  tenantId: string
  startsAt: string
  endsAt: string
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show"
  confirmationStatus: string
  followUpStatus: string
  calendarSource: string
  notes?: string | null
  tenant: { id: string; name: string }
  lead: { id: string; fullName: string }
}

type TenantUser = { id: string; tenantId: string; email: string; role: string; isActive: boolean }

type ReadinessItem = {
  key: string
  label: string
  passed: boolean
  required: boolean
  category: string
  responsibleParty: "client" | "jayden" | "provider" | "platform"
  statusMessage: string
  nextAction?: string | null
  verifiedAt?: string | null
  verifiedBy?: string | null
}

type TenantReadiness = {
  state: string
  activationStatus: string
  ready: boolean
  testingReady: boolean
  testingBlockers: ReadinessItem[]
  blockers: ReadinessItem[]
  required: ReadinessItem[]
  enabledServices: { sms: boolean; email: boolean; booking: boolean }
  externalProviderApprovals: {
    twilio: { required: boolean; status: string; recorded: boolean }
    sendgrid: { required: boolean; status: string; recorded: boolean }
  }
  lastUpdatedAt?: string
}

type UsagePolicy = {
  id: string
  maxSmsPerHour: number
  maxSmsPerDay: number
  maxEmailsPerHour: number
  maxEmailsPerDay: number
  maxAiCallsPerDay: number
  maxLeadsPerHour: number
  warningPercentage: number
  warningCostThresholdUsd: number
  hardCostThresholdUsd: number
  enabled: boolean
}

type ClientSetup = {
  tenant: Tenant
  owner: { id: string; email: string; role: string; isEmailVerified: boolean }
  temporaryPassword: string
  verifyLink: string
  verificationEmailSent: boolean
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

type AuditLog = {
  id: string
  tenantId: string
  actorId: string
  actorEmail?: string | null
  action: string
  method: string
  path: string
  statusCode: number
  createdAt: string
}

type SuspendServiceResult = {
  lifecycleStatus: string
  suspendedAt: string
  reason: string
  source: string
}

type RestoreServiceResult = {
  lifecycleStatus: string
  restoredAt: string
}

type DataSection =
  | "overview"
  | "clients"
  | "applications"
  | "tasks"
  | "support"
  | "operators"
  | "leadAttention"
  | "connections"
  | "handoffs"
  | "appointments"
  | "ai"
  | "billing"
  | "health"
  | "access"
  | "audit"

type PriorityAction = {
  id: string
  severity: "critical" | "high" | "medium"
  name: string
  issue: string
  timestamp: string
  action: string
  onClick: () => void
}

const dataSectionLabels: Record<DataSection, string> = {
  overview: "platform summary",
  clients: "clients",
  applications: "client applications",
  tasks: "operations tasks",
  support: "support requests",
  operators: "staff assignments",
  leadAttention: "lead attention",
  connections: "integration status",
  handoffs: "human handoffs",
  appointments: "appointments",
  ai: "AI operations",
  billing: "billing",
  health: "system health",
  access: "staff access",
  audit: "audit log",
}

const viewDataSections: Record<AdminView, DataSection[]> = {
  overview: ["overview", "clients", "tasks", "support", "leadAttention", "ai"],
  clients: ["clients", "operators", "leadAttention", "connections", "handoffs"],
  leads: ["applications", "leadAttention", "operators", "clients", "handoffs", "appointments"],
  onboarding: ["clients", "operators"],
  tasks: ["tasks", "operators", "clients"],
  support: ["support", "operators", "clients"],
  billing: ["billing", "clients"],
  health: ["health", "ai", "clients"],
  audit: ["audit"],
  settings: ["ai", "access"],
}

const ownerViews = new Set(secondaryAdminNavigation.map((item) => item.id))

const titleByView: Record<AdminView, { title: string; description: string }> = {
  overview: { title: "Overview", description: "Platform status and the next work that needs attention." },
  clients: { title: "Clients", description: "Service, setup, payment, and ownership in one workspace." },
  leads: { title: "Leads", description: "Client leads and new business inquiries requiring action." },
  onboarding: { title: "Onboarding", description: "Launch progress, blockers, and direct next steps." },
  tasks: { title: "Tasks", description: "Operational work, owners, priorities, and due dates." },
  support: { title: "Support", description: "Client requests ordered by urgency and age." },
  billing: { title: "Billing", description: "Recurring revenue, payment failures, and billing actions." },
  health: { title: "System health", description: "Operational provider and delivery status in plain language." },
  audit: { title: "Audit log", description: "Recorded administrative changes for this platform account." },
  settings: { title: "Settings", description: "Messaging, AI controls, booking, and staff access." },
}

const clientTabs: Array<{ id: ClientTab; label: string; ownerOnly?: boolean }> = [
  { id: "overview", label: "Overview" },
  { id: "leads", label: "Leads" },
  { id: "conversations", label: "Conversations" },
  { id: "appointments", label: "Appointments" },
  { id: "setup", label: "Setup" },
  { id: "billing", label: "Billing", ownerOnly: true },
  { id: "activity", label: "Activity" },
]

const onboardingGroups: Array<{ label: string; keys: string[] }> = [
  { label: "Account created", keys: [] },
  {
    label: "Business information completed",
    keys: ["business_identity", "contacts", "service_scope", "lead_handling", "target_launch_date", "provider_owner", "timezone", "quiet_hours"],
  },
  { label: "Branding completed", keys: ["brand"] },
  { label: "Lead source connected", keys: ["meta", "intake_api", "intake_api_test"] },
  { label: "Booking link verified", keys: ["booking_url"] },
  {
    label: "Message settings approved",
    keys: ["consent_policy", "twilio", "sendgrid", "twilio_provider_approval", "sendgrid_provider_approval", "sms_template", "email_template"],
  },
  { label: "Test lead completed", keys: ["test_lead", "inbound_sms", "inbound_email", "stop", "provider_rejection"] },
  { label: "Safety configured", keys: ["usage_limits", "disaster_recovery", "legal_review", "tenant_safety"] },
  { label: "Launch approved", keys: ["client_approval", "operator_approval", "billing_evidence", "global_pause"] },
]

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function label(value?: string | null) {
  return String(value || "Not set")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function currency(cents: number | string, code = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code.toUpperCase() }).format(
    Number(cents || 0) / 100,
  )
}

function age(timestamp?: string | null) {
  if (!timestamp) return "No timestamp"
  const elapsed = Math.max(Date.now() - new Date(timestamp).getTime(), 0)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return minutes <= 1 ? "Just now" : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function onboardingStatus(tenant: Tenant) {
  if (tenant.lifecycleStatus === "ACTIVE") return "Complete"
  if (["SUSPENDED", "UAT_FAILED"].includes(tenant.lifecycleStatus)) return "Blocked"
  if (["READY_FOR_UAT", "READY_FOR_ACTIVATION"].includes(tenant.lifecycleStatus)) return "Ready for review"
  if (["DRAFT", "ONBOARDING"].includes(tenant.lifecycleStatus)) return "In progress"
  return "Not started"
}

function severityRank(value: PriorityAction["severity"]) {
  return value === "critical" ? 3 : value === "high" ? 2 : 1
}

function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [delay, value])
  return debounced
}

export function AdminDashboardClient({
  initialView,
  initialTenantId,
  initialClientTab,
}: {
  initialView: AdminView
  initialTenantId?: string
  initialClientTab: ClientTab
}) {
  const router = useRouter()
  const me = useAdminSession()
  const isOwner = me.platformRole === "super_admin"
  const permittedInitialView = !isOwner && ownerViews.has(initialView) ? "overview" : initialView

  const [view, setView] = useState<AdminView>(permittedInitialView)
  const [clientTab, setClientTab] = useState<ClientTab>(initialClientTab)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<DataSection, string>>>({})
  const [sectionLoading, setSectionLoading] = useState<Partial<Record<DataSection, boolean>>>({})
  const [overview, setOverview] = useState<Overview | null>(null)
  const [billing, setBilling] = useState<BillingOverview | null>(null)
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [setupChecker, setSetupChecker] = useState<SetupChecker | null>(null)
  const [ownerExceptions, setOwnerExceptions] = useState<OwnerExceptions | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [applications, setApplications] = useState<ProspectApplication[]>([])
  const [tasks, setTasks] = useState<OperationsTask[]>([])
  const [support, setSupport] = useState<SupportTicket[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [platformUsers, setPlatformUsers] = useState<PlatformAccessUser[]>([])
  const [leadAttention, setLeadAttention] = useState<LeadAttention[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [handoffs, setHandoffs] = useState<ClientHandoff[]>([])
  const [appointments, setAppointments] = useState<ClientAppointment[]>([])
  const [aiOverview, setAiOverview] = useState<AiOverview | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditLimit, setAuditLimit] = useState(25)

  const [search, setSearch] = useState("")
  const [globalSearch, setGlobalSearch] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("all")
  const [clientFilter, setClientFilter] = useState("needs_attention")
  const [leadFilter, setLeadFilter] = useState("requires_response")
  const [taskFilter, setTaskFilter] = useState("open")
  const [supportFilter, setSupportFilter] = useState("open")
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [evidence, setEvidence] = useState<Record<string, string>>({})
  const [technicalEvidence, setTechnicalEvidence] = useState<Record<string, Record<string, string>>>({})
  const [testSmsRecipient, setTestSmsRecipient] = useState("")
  const [testEmailRecipient, setTestEmailRecipient] = useState("")
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null)

  const [showCreateClient, setShowCreateClient] = useState(false)
  const [businessName, setBusinessName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [newClientOwner, setNewClientOwner] = useState("")
  const [sourceApplicationId, setSourceApplicationId] = useState<string | null>(null)
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientSetup, setClientSetup] = useState<ClientSetup | null>(null)

  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])
  const [readiness, setReadiness] = useState<TenantReadiness | null>(null)
  const [usagePolicy, setUsagePolicy] = useState<UsagePolicy | null>(null)
  const [clientDetailsLoading, setClientDetailsLoading] = useState(false)
  const [clientDetailsError, setClientDetailsError] = useState("")
  const [clientCommunications, setClientCommunications] = useState<Communication[]>([])
  const [clientAppointments, setClientAppointments] = useState<ClientAppointment[]>([])
  const [clientTabLoading, setClientTabLoading] = useState(false)

  const [serviceAction, setServiceAction] = useState<"suspend" | "restore" | null>(null)
  const [serviceBusy, setServiceBusy] = useState(false)
  const [serviceError, setServiceError] = useState("")
  const [confirmAiPause, setConfirmAiPause] = useState(false)

  const loadedSections = useRef(new Set<DataSection>())
  const inFlightSections = useRef(new Map<DataSection, Promise<void>>())
  const clientRequest = useRef(0)
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => {
    setView(!isOwner && ownerViews.has(initialView) ? "overview" : initialView)
  }, [initialView, isOwner])

  useEffect(() => {
    setClientTab(!isOwner && initialClientTab === "billing" ? "overview" : initialClientTab)
  }, [initialClientTab, isOwner])

  const loadDataSection = useCallback(async (section: DataSection, force = false) => {
    if (!force && loadedSections.current.has(section)) return
    const existing = inFlightSections.current.get(section)
    if (existing) return existing

    const request = (async () => {
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
        if (section === "leadAttention")
          setLeadAttention(await apiFetch<LeadAttention[]>("/admin/lead-attention?take=50"))
        if (section === "connections") setConnections(await apiFetch<Connection[]>("/admin/integrations-overview"))
        if (section === "handoffs")
          setHandoffs(await apiFetch<ClientHandoff[]>("/admin/client-operations/handoffs?take=100"))
        if (section === "appointments")
          setAppointments(await apiFetch<ClientAppointment[]>("/admin/client-operations/appointments?take=100"))
        if (section === "ai") setAiOverview(await apiFetch<AiOverview>("/admin/ai/overview"))
        if (section === "billing") setBilling(await apiFetch<BillingOverview>("/admin/billing-overview"))
        if (section === "health") {
          const [nextHealth, nextSetup, nextExceptions] = await Promise.all([
            apiFetch<SystemHealth>("/admin/system-health"),
            apiFetch<SetupChecker>("/admin/setup-checker"),
            apiFetch<OwnerExceptions>("/admin/operations/exceptions"),
          ])
          setHealth(nextHealth)
          setSetupChecker(nextSetup)
          setOwnerExceptions(nextExceptions)
        }
        if (section === "access") setPlatformUsers(await apiFetch<PlatformAccessUser[]>("/admin/platform-access"))
        if (section === "audit") setAuditLogs(await apiFetch<AuditLog[]>("/audit?take=100"))
        loadedSections.current.add(section)
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
        inFlightSections.current.delete(section)
      }
    })()

    inFlightSections.current.set(section, request)
    return request
  }, [])

  useEffect(() => {
    const sections = [...viewDataSections[view]]
    if (view === "overview" && isOwner) sections.push("health")
    void Promise.allSettled(sections.map((section) => loadDataSection(section)))
  }, [isOwner, loadDataSection, view])

  const loadClientCore = useCallback(async (tenant: Tenant) => {
    const requestId = ++clientRequest.current
    setClientDetailsLoading(true)
    setClientDetailsError("")
    setTenantUsers([])
    setReadiness(null)
    setUsagePolicy(null)
    try {
      const [users, status, limits] = await Promise.all([
        apiFetch<TenantUser[]>(`/admin/tenants/${tenant.id}/users`),
        apiFetch<TenantReadiness>(`/admin/tenants/${tenant.id}/readiness`),
        isOwner
          ? apiFetch<UsagePolicy>(`/admin/tenants/${tenant.id}/usage-policy`)
          : Promise.resolve(null),
      ])
      if (requestId !== clientRequest.current) return
      setTenantUsers(users)
      setReadiness(status)
      setUsagePolicy(limits)
    } catch (cause) {
      if (requestId === clientRequest.current) {
        setClientDetailsError(messageFor(cause, "Client details could not be loaded"))
      }
    } finally {
      if (requestId === clientRequest.current) setClientDetailsLoading(false)
    }
  }, [isOwner])

  useEffect(() => {
    if (!initialTenantId) {
      clientRequest.current += 1
      setSelectedTenant(null)
      setTenantUsers([])
      setReadiness(null)
      setUsagePolicy(null)
      return
    }
    const tenant = tenants.find((item) => item.id === initialTenantId)
    if (!tenant) return
    setSelectedTenant(tenant)
    void loadClientCore(tenant)
  }, [initialTenantId, loadClientCore, tenants])

  useEffect(() => {
    if (!selectedTenant || !["conversations", "activity"].includes(clientTab)) return
    let active = true
    setClientTabLoading(true)
    void apiFetch<Communication[]>(`/admin/communications?tenantId=${selectedTenant.id}&take=50`)
      .then((items) => {
        if (active) setClientCommunications(items)
      })
      .catch((cause) => {
        if (active) setClientDetailsError(messageFor(cause, "Client conversations could not be loaded"))
      })
      .finally(() => {
        if (active) setClientTabLoading(false)
      })
    return () => {
      active = false
    }
  }, [clientTab, selectedTenant])

  useEffect(() => {
    if (!selectedTenant || clientTab !== "appointments") return
    let active = true
    setClientTabLoading(true)
    void apiFetch<ClientAppointment[]>(`/admin/client-operations/appointments?tenantId=${selectedTenant.id}&take=100`)
      .then((items) => {
        if (active) setClientAppointments(items)
      })
      .catch((cause) => {
        if (active) setClientDetailsError(messageFor(cause, "Client appointments could not be loaded"))
      })
      .finally(() => {
        if (active) setClientTabLoading(false)
      })
    return () => {
      active = false
    }
  }, [clientTab, selectedTenant])

  function switchView(next: AdminView, tenantId?: string, nextClientTab?: ClientTab) {
    if (!isOwner && ownerViews.has(next)) next = "overview"
    setView(next)
    const query = new URLSearchParams({ view: next })
    if (tenantId) query.set("tenantId", tenantId)
    if (tenantId && nextClientTab) query.set("clientTab", nextClientTab)
    router.push(`/admin/dashboard?${query.toString()}`, { scroll: false })
  }

  function switchClientTab(next: string) {
    if (!selectedTenant) return
    const safeTab = (!isOwner && next === "billing" ? "overview" : next) as ClientTab
    setClientTab(safeTab)
    switchView("clients", selectedTenant.id, safeTab)
  }

  function submitGlobalSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = globalSearch.trim().toLowerCase()
    if (!query) return
    const tenant = tenants.find((item) => item.name.toLowerCase().includes(query))
    if (tenant) {
      switchView("clients", tenant.id, "overview")
      return
    }
    setSearch(globalSearch.trim())
    if (leadAttention.some((item) => item.fullName.toLowerCase().includes(query))) switchView("leads")
    else if (tasks.some((item) => `${item.title} ${item.description}`.toLowerCase().includes(query)))
      switchView("tasks")
    else if (support.some((item) => `${item.subject} ${item.email}`.toLowerCase().includes(query)))
      switchView("support")
    else switchView("leads")
  }

  async function patchApplication(item: ProspectApplication, patch: Record<string, unknown>) {
    try {
      const updated = await apiFetch<ProspectApplication>(`/admin/applications/${item.id}`, {
        method: "PATCH",
        body: patch,
      })
      setApplications((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      setNotice("Lead updated.")
    } catch (cause) {
      setError(messageFor(cause, "Lead could not be updated"))
    }
  }

  function prepareClient(item: ProspectApplication) {
    setBusinessName(item.company || item.name)
    setOwnerEmail(item.email)
    setNewClientOwner(item.assignedOperatorId || "")
    setSourceApplicationId(item.id)
    setShowCreateClient(true)
    switchView("clients")
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreatingClient(true)
    setError("")
    try {
      const result = await apiFetch<ClientSetup>("/admin/tenants", {
        method: "POST",
        body: { businessName, ownerEmail, assignedOperatorId: newClientOwner || null },
      })
      setClientSetup(result)
      setTenants((current) => [result.tenant, ...current])
      if (sourceApplicationId) {
        const source = applications.find((item) => item.id === sourceApplicationId)
        if (source) {
          await patchApplication(source, {
            status: "accepted",
            operatorNotes: notes[source.id] || source.operatorNotes || "Converted to client workspace.",
          })
        }
      }
      setBusinessName("")
      setOwnerEmail("")
      setNewClientOwner("")
      setSourceApplicationId(null)
      setShowCreateClient(false)
      setNotice("Client workspace created. Save the secure handoff details below.")
    } catch (cause) {
      setError(messageFor(cause, "Client workspace could not be created"))
    } finally {
      setCreatingClient(false)
    }
  }

  async function patchTask(item: OperationsTask, patch: Record<string, unknown>) {
    try {
      const updated = await apiFetch<OperationsTask>(`/admin/operations/${item.id}`, {
        method: "PATCH",
        body: patch,
      })
      setTasks((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      setNotice("Task updated.")
    } catch (cause) {
      setError(messageFor(cause, "Task could not be updated"))
    }
  }

  async function patchSupport(item: SupportTicket, patch: Record<string, unknown>) {
    try {
      const updated = await apiFetch<SupportTicket>(`/support/admin/tickets/${item.id}`, {
        method: "PATCH",
        body: patch,
      })
      setSupport((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      setNotice("Support request updated.")
    } catch (cause) {
      setError(messageFor(cause, "Support request could not be updated"))
    }
  }

  async function patchHandoff(item: ClientHandoff, action: "opened" | "completed" | "snoozed") {
    try {
      const updated = await apiFetch<ClientHandoff>(`/admin/client-operations/handoffs/${item.id}`, {
        method: "PATCH",
        body: { action, note: action === "completed" ? "Completed by platform staff" : undefined },
      })
      setHandoffs((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)))
      setNotice("Human handoff updated.")
    } catch (cause) {
      setError(messageFor(cause, "Human handoff could not be updated"))
    }
  }

  async function patchAppointment(item: ClientAppointment, patch: Record<string, unknown>) {
    try {
      const updated = await apiFetch<ClientAppointment>(`/admin/client-operations/appointments/${item.id}`, {
        method: "PATCH",
        body: patch,
      })
      setAppointments((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)))
      setClientAppointments((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)))
      setNotice("Appointment updated.")
    } catch (cause) {
      setError(messageFor(cause, "Appointment could not be updated"))
    }
  }

  async function refreshReadiness() {
    if (!selectedTenant) return
    setReadiness(await apiFetch<TenantReadiness>(`/admin/tenants/${selectedTenant.id}/readiness`))
  }

  async function recordEvidence(patch: Record<string, unknown>) {
    if (!selectedTenant) return
    try {
      await apiFetch(`/admin/tenants/${selectedTenant.id}/onboarding-evidence`, {
        method: "POST",
        body: patch,
      })
      await refreshReadiness()
      setNotice("Onboarding evidence saved.")
    } catch (cause) {
      setError(messageFor(cause, "Evidence could not be saved"))
    }
  }

  async function startTesting() {
    if (!selectedTenant) return
    try {
      await apiFetch(`/admin/tenants/${selectedTenant.id}/testing/run`, {
        method: "POST",
        body: {
          smsRecipient: testSmsRecipient.trim() || undefined,
          emailRecipient: testEmailRecipient.trim() || undefined,
        },
      })
      await refreshReadiness()
      setTenants((current) =>
        current.map((tenant) =>
          tenant.id === selectedTenant.id
            ? { ...tenant, lifecycleStatus: "TESTING" }
            : tenant,
        ),
      )
      setSelectedTenant((current) =>
        current ? { ...current, lifecycleStatus: "TESTING" } : current,
      )
      setNotice("The controlled lead entered the real queue. Provider callbacks and replies will record evidence automatically.")
    } catch (cause) {
      setError(messageFor(cause, "Testing mode could not be started"))
    }
  }

  async function saveUsagePolicy() {
    if (!selectedTenant || !usagePolicy) return
    try {
      const saved = await apiFetch<UsagePolicy>(
        `/admin/tenants/${selectedTenant.id}/usage-policy`,
        { method: "PUT", body: usagePolicy },
      )
      setUsagePolicy(saved)
      await refreshReadiness()
      setNotice("Usage and cost safety limits saved.")
    } catch (cause) {
      setError(messageFor(cause, "Usage limits could not be saved"))
    }
  }

  function updateTechnicalEvidence(key: string, value: string) {
    if (!selectedTenant) return
    setTechnicalEvidence((current) => ({
      ...current,
      [selectedTenant.id]: {
        ...(current[selectedTenant.id] || {}),
        [key]: value,
      },
    }))
  }

  function technicalEvidenceValue(key: string) {
    return selectedTenant ? technicalEvidence[selectedTenant.id]?.[key] || "" : ""
  }

  async function assignClient(tenant: Tenant, assignedOperatorId: string) {
    try {
      const updated = await apiFetch<Tenant>(`/admin/tenants/${tenant.id}/assignment`, {
        method: "PATCH",
        body: { assignedOperatorId: assignedOperatorId || null },
      })
      setTenants((current) =>
        current.map((row) =>
          row.id === updated.id ? { ...row, assignedOperatorId: updated.assignedOperatorId } : row,
        ),
      )
      setSelectedTenant((current) =>
        current?.id === tenant.id ? { ...current, assignedOperatorId: updated.assignedOperatorId } : current,
      )
      setNotice("Client owner updated.")
    } catch (cause) {
      setError(messageFor(cause, "Client assignment could not be changed"))
    }
  }

  async function changeService(action: "activate" | "pause") {
    if (!selectedTenant) return
    try {
      await apiFetch(`/admin/tenants/${selectedTenant.id}/${action}`, { method: "POST" })
      await Promise.all([refreshReadiness(), loadDataSection("clients", true)])
      setNotice(action === "activate" ? "Client service activated." : "Client automations paused.")
    } catch (cause) {
      setError(messageFor(cause, `Client service could not be ${action === "activate" ? "activated" : "paused"}`))
      await refreshReadiness().catch(() => undefined)
    }
  }

  async function confirmServiceAction(reason?: string) {
    if (!selectedTenant || !serviceAction || !isOwner) return
    setServiceBusy(true)
    setServiceError("")
    try {
      if (serviceAction === "suspend") {
        const result = await apiFetch<SuspendServiceResult>(`/admin/tenants/${selectedTenant.id}/suspend`, {
          method: "POST",
          body: { reason },
        })
        const updated: Tenant = {
          ...selectedTenant,
          lifecycleStatus: result.lifecycleStatus,
          serviceState: { state: "suspended", label: "Services suspended", reason: result.reason },
          serviceSuspendedAt: result.suspendedAt,
          serviceSuspensionReason: result.reason,
          serviceSuspensionSource: result.source,
          serviceSuspendedById: me.userId,
        }
        setSelectedTenant(updated)
        setTenants((current) => current.map((tenant) => (tenant.id === updated.id ? updated : tenant)))
        setNotice("Client services suspended. Automated SMS, email, sequences, and reminders are stopped.")
      } else {
        const result = await apiFetch<RestoreServiceResult>(`/admin/tenants/${selectedTenant.id}/restore`, {
          method: "POST",
        })
        const active = result.lifecycleStatus === "ACTIVE"
        const updated: Tenant = {
          ...selectedTenant,
          lifecycleStatus: result.lifecycleStatus,
          serviceState: {
            state: active ? "active" : "paused",
            label: active ? "Services active" : "Automations paused",
            reason: active ? "Services restored after account review." : "Account restored and awaiting activation.",
          },
          serviceSuspendedAt: null,
          serviceSuspensionReason: null,
          serviceRestoredAt: result.restoredAt,
          serviceRestoredById: me.userId,
        }
        setSelectedTenant(updated)
        setTenants((current) => current.map((tenant) => (tenant.id === updated.id ? updated : tenant)))
        setNotice(active ? "Client services restored." : "Client account restored and left paused for review.")
      }
      await Promise.all([
        refreshReadiness().catch(() => undefined),
        loadDataSection("tasks", true).catch(() => undefined),
      ])
      setServiceAction(null)
    } catch (cause) {
      setServiceError(
        messageFor(
          cause,
          serviceAction === "suspend"
            ? "Client services could not be suspended"
            : "Client services could not be restored",
        ),
      )
    } finally {
      setServiceBusy(false)
    }
  }

  async function impersonate(userId: string) {
    try {
      await apiFetch("/admin/impersonate", { method: "POST", body: { userId } })
      window.location.assign("/app/dashboard")
    } catch (cause) {
      setError(messageFor(cause, "Client workspace could not be opened"))
    }
  }

  async function setStaffAccess(user: PlatformAccessUser, enabled: boolean) {
    try {
      const updated = await apiFetch<PlatformAccessUser>(`/admin/platform-access/${user.id}`, {
        method: "PATCH",
        body: { enabled },
      })
      setPlatformUsers((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      setNotice(enabled ? "Staff access enabled." : "Staff access removed.")
    } catch (cause) {
      setError(messageFor(cause, "Staff access could not be changed"))
    }
  }

  async function setPlatformAiPause(paused: boolean) {
    try {
      await apiFetch("/admin/ai/emergency-pause", {
        method: "POST",
        body: { paused, reason: paused ? "Platform emergency pause activated by the platform owner." : "" },
      })
      await loadDataSection("ai", true)
      setNotice(paused ? "All AI activity paused." : "Platform AI pause cleared.")
    } catch (cause) {
      setError(messageFor(cause, "Platform AI pause could not be changed"))
    }
  }

  const operatorNames = useMemo(() => new Map(operators.map((operator) => [operator.id, operator.email])), [operators])
  const tenantNames = useMemo(() => new Map(tenants.map((tenant) => [tenant.id, tenant.name])), [tenants])
  const connectionsByTenant = useMemo(() => {
    const grouped = new Map<string, Connection[]>()
    for (const connection of connections) {
      const existing = grouped.get(connection.tenantId)
      if (existing) existing.push(connection)
      else grouped.set(connection.tenantId, [connection])
    }
    return grouped
  }, [connections])

  const operatorName = useCallback(
    (id?: string | null) => (id ? operatorNames.get(id) : null) || "Unassigned",
    [operatorNames],
  )

  const tenantName = useCallback((id?: string | null) => (id ? tenantNames.get(id) : null) || "Platform", [tenantNames])

  function integrationState(tenantId: string) {
    const items = connectionsByTenant.get(tenantId) || []
    if (!items.length) return { label: "Not configured", issue: true }
    if (items.some((item) => item.needsAttention || ["error", "disconnected"].includes(item.status))) {
      return { label: "Needs attention", issue: true }
    }
    return { label: "Connected", issue: false }
  }

  function clientNeedsAttention(tenant: Tenant) {
    return (
      tenant.serviceState?.state === "suspended" ||
      ["payment_overdue", "grace_period"].includes(tenant.serviceState?.state || "") ||
      ["ONBOARDING", "UAT_FAILED", "READY_FOR_UAT", "READY_FOR_ACTIVATION"].includes(tenant.lifecycleStatus) ||
      integrationState(tenant.id).issue
    )
  }

  const normalizedSearch = debouncedSearch.trim().toLowerCase()
  const matches = (value: string) => !normalizedSearch || value.toLowerCase().includes(normalizedSearch)
  const ownerMatches = (id?: string | null) =>
    ownerFilter === "all" || (ownerFilter === "unassigned" ? !id : id === ownerFilter)

  const filteredTenants = tenants
    .filter((tenant) => {
      if (!matches(tenant.name) || !ownerMatches(tenant.assignedOperatorId)) return false
      if (clientFilter === "all") return true
      if (clientFilter === "needs_attention") return clientNeedsAttention(tenant)
      if (clientFilter === "active") return tenant.lifecycleStatus === "ACTIVE"
      if (clientFilter === "setup_incomplete")
        return ["DRAFT", "ONBOARDING", "READY_FOR_UAT", "UAT_FAILED", "READY_FOR_ACTIVATION"].includes(
          tenant.lifecycleStatus,
        )
      if (clientFilter === "payment_overdue")
        return ["payment_overdue", "grace_period"].includes(tenant.serviceState?.state || "")
      if (clientFilter === "suspended") return tenant.serviceState?.state === "suspended"
      if (clientFilter === "integration_issue") return integrationState(tenant.id).issue
      return true
    })
    .sort(
      (a, b) =>
        Number(clientNeedsAttention(b)) - Number(clientNeedsAttention(a)) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )

  const filteredTasks = tasks
    .filter(
      (item) =>
        matches(`${item.title} ${item.description} ${item.category} ${tenantName(item.tenantId)}`) &&
        ownerMatches(item.assignedOperatorId),
    )
    .filter(
      (item) =>
        taskFilter === "all" || (taskFilter === "open" ? item.status !== "resolved" : item.status === taskFilter),
    )
    .sort((a, b) => {
      const priority = { critical: 4, high: 3, normal: 2, low: 1 }
      return (
        priority[b.priority] - priority[a.priority] ||
        new Date(a.dueAt || a.createdAt).getTime() - new Date(b.dueAt || b.createdAt).getTime()
      )
    })

  const filteredSupport = support
    .filter(
      (item) =>
        matches(`${item.subject} ${item.message} ${item.email} ${tenantName(item.tenantId)}`) &&
        ownerMatches(item.assignedOperatorId),
    )
    .filter(
      (item) =>
        supportFilter === "all" ||
        (supportFilter === "open" ? !["resolved", "closed"].includes(item.status) : item.status === supportFilter),
    )
    .sort((a, b) => {
      const priority = { urgent: 4, high: 3, normal: 2, low: 1 }
      return (
        priority[b.severity] - priority[a.severity] || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    })

  const selectedApplication = applications.find((item) => item.id === selectedApplicationId) || null

  const leadRows = (() => {
    const clientLeads = leadAttention.map((item) => ({
      id: item.id,
      kind: "client" as const,
      name: item.fullName,
      client: item.tenant.name,
      source: item.source || "Client workspace",
      stage: item.stage,
      communication:
        item.communicationStatus ||
        (item.readinessLevel === "urgent" || item.temperature === "hot" ? "Requires response" : "Active"),
      nextAction: item.recommendedNextAction || "Review the conversation and choose the next follow-up.",
      lastContact: item.lastContactedAt || item.createdAt,
      owner: tenants.find((tenant) => tenant.id === item.tenant.id)?.assignedOperatorId || null,
      tenantId: item.tenant.id,
      original: item,
    }))
    const salesLeads = applications.map((item) => ({
      id: item.id,
      kind: "application" as const,
      name: item.company || item.name,
      client: "RealtyTechAI",
      source: item.source || "Website",
      stage: item.status,
      communication:
        item.notificationStatus === "failed"
          ? "Alert failed"
          : item.assignedOperatorId
            ? "Assigned"
            : "Requires response",
      nextAction: item.status === "new" ? "Review and assign this inquiry." : "Continue the sales follow-up.",
      lastContact: item.updatedAt || item.createdAt,
      owner: item.assignedOperatorId || null,
      tenantId: null,
      original: item,
    }))
    return [...clientLeads, ...salesLeads]
      .filter(
        (item) =>
          matches(
            `${item.name} ${item.client} ${item.source} ${item.stage} ${item.communication} ${item.nextAction}`,
          ) && ownerMatches(item.owner),
      )
      .filter((item) => {
        if (leadFilter === "all") return true
        if (leadFilter === "new") return item.stage === "new"
        if (leadFilter === "requires_response")
          return /requires response|urgent|hot|alert failed/i.test(
            `${item.communication} ${"readinessLevel" in item.original ? item.original.readinessLevel : ""} ${"temperature" in item.original ? item.original.temperature : ""}`,
          )
        if (leadFilter === "appointment_scheduled")
          return ["appointment_set", "consultation_booked", "showing_scheduled"].includes(item.stage)
        if (leadFilter === "follow_up_due") return /follow.?up/i.test(item.nextAction)
        if (leadFilter === "paused") return item.communication.toLowerCase() === "paused"
        if (leadFilter === "opted_out") return item.communication.toLowerCase() === "opted out"
        if (leadFilter === "lost") return ["lost", "declined"].includes(item.stage)
        return true
      })
      .sort((a, b) => new Date(b.lastContact).getTime() - new Date(a.lastContact).getTime())
  })()

  const urgentTasks = tasks.filter((item) => item.status !== "resolved" && ["high", "critical"].includes(item.priority))
  const urgentSupport = support.filter(
    (item) => !["resolved", "closed"].includes(item.status) && ["high", "urgent"].includes(item.severity),
  )
  const urgentClientLeads = leadAttention.filter(
    (item) => item.readinessLevel === "urgent" || item.temperature === "hot",
  )
  const onboardingClients = tenants.filter((item) =>
    ["DRAFT", "ONBOARDING", "READY_FOR_UAT", "UAT_FAILED", "READY_FOR_ACTIVATION"].includes(item.lifecycleStatus),
  )
  const clientsNeedingAttention = tenants.filter(clientNeedsAttention)

  const priorityActions: PriorityAction[] = [
    ...tenants
      .filter((tenant) => tenant.serviceState?.state === "suspended")
      .map(
        (tenant): PriorityAction => ({
          id: `suspended-${tenant.id}`,
          severity: "critical",
          name: tenant.name,
          issue: tenant.serviceSuspensionReason || "Client services are suspended.",
          timestamp: tenant.serviceSuspendedAt || tenant.updatedAt,
          action: "Open client",
          onClick: () => switchView("clients", tenant.id, "overview"),
        }),
      ),
    ...tenants
      .filter((tenant) => ["payment_overdue", "grace_period"].includes(tenant.serviceState?.state || ""))
      .map(
        (tenant): PriorityAction => ({
          id: `billing-${tenant.id}`,
          severity: "critical",
          name: tenant.name,
          issue: tenant.serviceState?.reason || "Payment requires owner attention.",
          timestamp: tenant.lastPaymentFailureAt || tenant.updatedAt,
          action: "Review client",
          onClick: () => switchView("clients", tenant.id, "billing"),
        }),
      ),
    ...urgentClientLeads.map(
      (lead): PriorityAction => ({
        id: `lead-${lead.id}`,
        severity: lead.readinessLevel === "urgent" ? "critical" : "high",
        name: lead.fullName,
        issue: `${lead.tenant.name}: ${lead.recommendedNextAction || "A human response is required."}`,
        timestamp: lead.lastContactedAt || lead.createdAt,
        action: "Review lead",
        onClick: () => switchView("clients", lead.tenant.id, "leads"),
      }),
    ),
    ...urgentTasks.map(
      (task): PriorityAction => ({
        id: `task-${task.id}`,
        severity: task.priority === "critical" ? "critical" : "high",
        name: tenantName(task.tenantId),
        issue: task.title,
        timestamp: task.dueAt || task.createdAt,
        action: "Open task",
        onClick: () => switchView("tasks"),
      }),
    ),
    ...urgentSupport.map(
      (ticket): PriorityAction => ({
        id: `support-${ticket.id}`,
        severity: ticket.severity === "urgent" ? "critical" : "high",
        name: tenantName(ticket.tenantId),
        issue: ticket.subject,
        timestamp: ticket.createdAt,
        action: "Open request",
        onClick: () => switchView("support"),
      }),
    ),
    ...onboardingClients
      .filter((tenant) => tenant.lifecycleStatus === "UAT_FAILED")
      .map(
        (tenant): PriorityAction => ({
          id: `onboarding-${tenant.id}`,
          severity: "medium",
          name: tenant.name,
          issue: "Onboarding is blocked after a failed launch test.",
          timestamp: tenant.updatedAt,
          action: "Resolve blocker",
          onClick: () => switchView("onboarding", tenant.id),
        }),
      ),
  ]
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
    .slice(0, 8)

  const recentActivity = [
    ...tenants.map((tenant) => ({
      id: `tenant-${tenant.id}`,
      title:
        tenant.serviceState?.state === "suspended"
          ? "Client services suspended"
          : tenant.lifecycleStatus === "ACTIVE"
            ? "Client active"
            : "Client setup updated",
      subject: tenant.name,
      timestamp: tenant.updatedAt,
    })),
    ...tasks
      .filter((task) => task.status === "resolved")
      .map((task) => ({
        id: `task-${task.id}`,
        title: "Task resolved",
        subject: task.title,
        timestamp: task.updatedAt,
      })),
    ...support
      .filter((ticket) => ticket.status === "resolved")
      .map((ticket) => ({
        id: `support-${ticket.id}`,
        title: "Support request resolved",
        subject: ticket.subject,
        timestamp: ticket.updatedAt,
      })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5)

  const currentSectionFailures = [
    ...viewDataSections[view],
    ...(view === "overview" && isOwner ? (["health"] as DataSection[]) : []),
  ].filter((section) => sectionErrors[section])

  const overviewLoading = view === "overview" && !overview && !sectionErrors.overview
  const canSuspendSelectedTenant = Boolean(
    selectedTenant && selectedTenant.lifecycleStatus === "ACTIVE" && selectedTenant.serviceState?.state !== "suspended",
  )
  const canRestoreSelectedTenant = Boolean(
    selectedTenant &&
    selectedTenant.lifecycleStatus !== "CANCELED" &&
    selectedTenant.serviceState?.state === "suspended",
  )
  const selectedTenantLeads = selectedTenant ? leadAttention.filter((lead) => lead.tenant.id === selectedTenant.id) : []
  const selectedTenantHandoffs = selectedTenant
    ? handoffs.filter((handoff) => handoff.tenantId === selectedTenant.id)
    : []
  const selectedIntegrationState = selectedTenant ? integrationState(selectedTenant.id) : null
  const selectedClientOwner = operatorName(selectedTenant?.assignedOperatorId)
  const selectedSuspendedBy =
    selectedTenant?.serviceSuspendedById === me.userId ? me.email : operatorName(selectedTenant?.serviceSuspendedById)

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b pb-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{titleByView[view].title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{titleByView[view].description}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form className="relative w-full sm:w-80" role="search" onSubmit={submitGlobalSearch}>
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-9"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search clients, leads, tasks…"
              aria-label="Search the admin workspace"
            />
          </form>
          <div className="flex items-center gap-2">
            <NotificationCenter />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="flex-1 sm:flex-none">
                  <Plus className="mr-2 h-4 w-4" />
                  Quick action
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Frequent actions</DropdownMenuLabel>
                {isOwner ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setShowCreateClient(true)
                      switchView("clients")
                    }}
                  >
                    <UserPlus />
                    Add client
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => switchView("leads")}>Review leads</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => switchView("tasks")}>Open tasks</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => switchView("support")}>Open support</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/logout")}>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {error ? <InlineNotice tone="error" text={error} onDismiss={() => setError("")} /> : null}
      {notice ? <InlineNotice tone="success" text={notice} onDismiss={() => setNotice("")} /> : null}

      {currentSectionFailures.length ? (
        <SectionFailures
          sections={currentSectionFailures}
          errors={sectionErrors}
          loading={sectionLoading}
          onRetry={(section) => void loadDataSection(section, true).catch(() => undefined)}
        />
      ) : null}

      {view === "overview" ? (
        overviewLoading ? (
          <OverviewSkeleton />
        ) : (
          <div className="space-y-6">
            <PlatformStatusBanner
              aiOverview={aiOverview}
              aiUnavailable={Boolean(sectionErrors.ai)}
              health={isOwner ? health : null}
              healthUnavailable={isOwner && Boolean(sectionErrors.health)}
              suspendedClients={tenants.filter((tenant) => tenant.serviceState?.state === "suspended")}
              onOpenSettings={() => switchView("settings")}
              onOpenHealth={() => switchView("health")}
              onOpenClients={() => {
                setClientFilter("suspended")
                switchView("clients")
              }}
            />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Priority summary">
              <SummaryCard
                label="Clients needing attention"
                value={sectionErrors.clients ? null : clientsNeedingAttention.length}
                onClick={() => {
                  setClientFilter("needs_attention")
                  switchView("clients")
                }}
              />
              <SummaryCard
                label="Leads requiring action"
                value={sectionErrors.leadAttention ? null : urgentClientLeads.length + (overview?.newApplications || 0)}
                onClick={() => {
                  setLeadFilter("requires_response")
                  switchView("leads")
                }}
              />
              <SummaryCard
                label="Incomplete onboarding"
                value={sectionErrors.clients ? null : onboardingClients.length}
                onClick={() => switchView("onboarding")}
              />
              <SummaryCard
                label="Open tasks and support"
                value={
                  sectionErrors.tasks || sectionErrors.support
                    ? null
                    : tasks.filter((item) => item.status !== "resolved").length +
                      support.filter((item) => !["resolved", "closed"].includes(item.status)).length
                }
                onClick={() => switchView(urgentTasks.length ? "tasks" : "support")}
              />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Action required</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Highest-priority work across clients, leads, tasks, and support.
                    </p>
                  </div>
                  <Badge variant={priorityActions.length ? "secondary" : "outline"}>
                    {priorityActions.length} shown
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {priorityActions.length ? (
                  <div className="divide-y rounded-md border" role="list">
                    {priorityActions.map((item) => (
                      <div
                        key={item.id}
                        className="grid gap-3 p-4 md:grid-cols-[auto_minmax(9rem,0.8fr)_minmax(14rem,1.7fr)_auto_auto] md:items-center"
                        role="listitem"
                      >
                        <SeverityBadge severity={item.severity} />
                        <div className="min-w-0 font-medium">{item.name}</div>
                        <div className="min-w-0 text-sm text-muted-foreground">{item.issue}</div>
                        <div className="text-xs text-muted-foreground">{age(item.timestamp)}</div>
                        <Button size="sm" variant="outline" onClick={item.onClick}>
                          {item.action}
                          <ArrowRight className="ml-2 h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Nothing needs immediate attention"
                    description="New blockers, urgent leads, and overdue work will appear here."
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Recent activity</CardTitle>
                  {isOwner ? (
                    <Button variant="ghost" size="sm" onClick={() => switchView("audit")}>
                      View audit log
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {recentActivity.length ? (
                  <div className="divide-y">
                    {recentActivity.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                        <div>
                          <div className="text-sm font-medium">{item.title}</div>
                          <div className="text-sm text-muted-foreground">{item.subject}</div>
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground">{age(item.timestamp)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No recent activity"
                    description="Meaningful client, task, and support updates will appear here."
                    compact
                  />
                )}
              </CardContent>
            </Card>
          </div>
        )
      ) : null}

      {view === "clients" ? (
        selectedTenant ? (
          <div className="space-y-5">
            <Button variant="ghost" className="-ml-3" onClick={() => switchView("clients")}>
              ← Back to clients
            </Button>
            <Card className={selectedTenant.serviceState?.state === "suspended" ? "border-destructive/50" : ""}>
              <CardContent className="p-5 md:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold">{selectedTenant.name}</h2>
                      <StatusBadge
                        value={selectedTenant.serviceState?.label || selectedTenant.lifecycleStatus}
                        tone={
                          selectedTenant.serviceState?.state === "suspended"
                            ? "danger"
                            : selectedTenant.lifecycleStatus === "ACTIVE"
                              ? "success"
                              : "neutral"
                        }
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                      <span>Setup: {onboardingStatus(selectedTenant)}</span>
                      {isOwner ? <span>Payment: {label(selectedTenant.status)}</span> : null}
                      <span>Assigned: {selectedClientOwner}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!readiness?.ready ? (
                      <Button variant="outline" onClick={() => switchClientTab("setup")}>
                        Open setup
                      </Button>
                    ) : null}
                    {isOwner && canRestoreSelectedTenant ? (
                      <Button
                        onClick={() => {
                          setServiceError("")
                          setServiceAction("restore")
                        }}
                      >
                        Restore services
                      </Button>
                    ) : null}
                    {isOwner && canSuspendSelectedTenant ? (
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setServiceError("")
                          setServiceAction("suspend")
                        }}
                      >
                        Suspend services
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            {selectedTenant.serviceState?.state === "suspended" ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" role="status">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
                  <div>
                    <div className="font-medium">Client services are suspended</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Automated SMS, email, sequences, and reminders are stopped. Data and conversation history are
                      preserved.
                    </p>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">Suspended by</dt>
                        <dd>{selectedSuspendedBy}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Time</dt>
                        <dd>
                          {selectedTenant.serviceSuspendedAt
                            ? new Date(selectedTenant.serviceSuspendedAt).toLocaleString()
                            : "Unavailable"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Reason</dt>
                        <dd>{selectedTenant.serviceSuspensionReason || "No reason available"}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            ) : null}

            {clientDetailsError ? (
              <InlineNotice tone="error" text={clientDetailsError} onDismiss={() => setClientDetailsError("")} />
            ) : null}

            <Tabs value={clientTab} onValueChange={switchClientTab}>
              <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0">
                {clientTabs
                  .filter((tab) => !tab.ownerOnly || isOwner)
                  .map((tab) => (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                    >
                      {tab.label}
                    </TabsTrigger>
                  ))}
              </TabsList>

              <TabsContent value="overview" className="mt-5 space-y-5">
                {clientDetailsLoading ? (
                  <ClientWorkspaceSkeleton />
                ) : (
                  <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                    <Section title="Current state" subtitle="What is working, what is blocked, and what to do next.">
                      <DefinitionRow
                        label="Service"
                        value={selectedTenant.serviceState?.label || label(selectedTenant.lifecycleStatus)}
                      />
                      <DefinitionRow label="Integration" value={selectedIntegrationState?.label || "Not configured"} />
                      <DefinitionRow
                        label="Setup"
                        value={
                          readiness?.ready
                            ? "All required checks pass"
                            : `${readiness?.blockers.length || 0} required check(s) remain`
                        }
                      />
                      <DefinitionRow
                        label="Next action"
                        value={
                          selectedTenant.serviceState?.state === "suspended"
                            ? "Resolve the suspension reason, confirm billing, then restore services."
                            : readiness?.ready
                              ? "Review and activate service when the client is approved."
                              : readiness?.blockers[0]?.label || "Review setup details."
                        }
                      />
                    </Section>
                    <Section title="Client owner" subtitle="Assignment and workspace access.">
                      {isOwner ? (
                        <OwnerSelect
                          value={selectedTenant.assignedOperatorId || ""}
                          operators={operators}
                          onChange={(value) => void assignClient(selectedTenant, value)}
                        />
                      ) : (
                        <DefinitionRow label="Assigned staff" value={selectedClientOwner} />
                      )}
                      <div className="space-y-2">
                        {tenantUsers.map((user) => (
                          <div key={user.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{user.email}</div>
                              <div className="text-xs text-muted-foreground">
                                {label(user.role)} · {user.isActive ? "Active" : "Inactive"}
                              </div>
                            </div>
                            {isOwner ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!user.isActive}
                                onClick={() => void impersonate(user.id)}
                              >
                                View as client
                              </Button>
                            ) : null}
                          </div>
                        ))}
                        {!tenantUsers.length ? (
                          <EmptyState
                            title="No client users"
                            description="Client users will appear after account creation."
                            compact
                          />
                        ) : null}
                      </div>
                    </Section>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="leads" className="mt-5 space-y-5">
                <Section title="Leads requiring attention" subtitle="Priority leads from this client workspace.">
                  {selectedTenantLeads.length ? (
                    selectedTenantLeads.map((lead) => (
                      <div
                        key={lead.id}
                        className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="font-medium">{lead.fullName}</div>
                          <div className="text-sm text-muted-foreground">
                            {label(lead.stage)} · {label(lead.communicationStatus || "active")}
                          </div>
                          <p className="mt-1 text-sm">
                            {lead.recommendedNextAction || "Review the conversation and choose the next follow-up."}
                          </p>
                        </div>
                        <StatusBadge
                          value={lead.readinessLevel === "urgent" ? "Requires response" : lead.temperature}
                          tone={lead.readinessLevel === "urgent" || lead.temperature === "hot" ? "danger" : "neutral"}
                        />
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      title="No leads require attention"
                      description="New, hot, and urgent leads for this client will appear here."
                    />
                  )}
                </Section>
                {selectedTenantHandoffs.length ? (
                  <Section title="Human handoffs" subtitle="AI conversations explicitly waiting for a person.">
                    {selectedTenantHandoffs.map((handoff) => (
                      <div
                        key={handoff.id}
                        className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="font-medium">{handoff.lead.fullName}</div>
                          <div className="text-sm text-muted-foreground">{handoff.reason}</div>
                          <p className="mt-1 text-sm">{handoff.recommendedAction}</p>
                        </div>
                        {handoff.status !== "completed" ? (
                          <Button size="sm" onClick={() => void patchHandoff(handoff, "completed")}>
                            Mark complete
                          </Button>
                        ) : (
                          <Badge variant="outline">Completed</Badge>
                        )}
                      </div>
                    ))}
                  </Section>
                ) : null}
              </TabsContent>

              <TabsContent value="conversations" className="mt-5">
                <Section title="Conversation history" subtitle="Read-only delivery history for this client.">
                  {clientTabLoading ? (
                    <LoadingRows />
                  ) : clientCommunications.length ? (
                    clientCommunications.map((item) => (
                      <div key={item.id} className="rounded-md border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{item.leadName}</div>
                          <Badge variant="secondary">
                            {label(item.channel)} · {label(item.status)}
                          </Badge>
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{item.body}</p>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {label(item.direction)} · {new Date(item.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      title="No conversations"
                      description="Messages for this client will appear here after contact begins."
                    />
                  )}
                </Section>
              </TabsContent>

              <TabsContent value="appointments" className="mt-5">
                <Section title="Appointments" subtitle="Upcoming and completed appointments for this client.">
                  {clientTabLoading ? (
                    <LoadingRows />
                  ) : clientAppointments.length ? (
                    clientAppointments.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="font-medium">{item.lead.fullName}</div>
                          <div className="text-sm text-muted-foreground">
                            {new Date(item.startsAt).toLocaleString()} · {label(item.calendarSource)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge value={item.status} tone={item.status === "confirmed" ? "success" : "neutral"} />
                          {["scheduled", "confirmed"].includes(item.status) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void patchAppointment(item, { status: "completed" })}
                            >
                              Complete
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      title="No appointments"
                      description="Scheduled appointments for this client will appear here."
                    />
                  )}
                </Section>
              </TabsContent>

              <TabsContent value="setup" className="mt-5 space-y-5">
                <Section
                  title="Setup checklist"
                  subtitle="Required launch checks from the existing onboarding service."
                >
                  {clientDetailsLoading ? (
                    <LoadingRows />
                  ) : readiness?.required.length ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {readiness.required.map((item) => (
                        <div key={item.key} className="flex gap-3 rounded-md border p-3 text-sm">
                          {item.passed ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          )}
                          <div>
                            <div>{item.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {item.passed ? "Complete" : item.statusMessage}
                            </div>
                            {!item.passed && item.nextAction ? <div className="mt-1 text-xs text-muted-foreground">Next: {item.nextAction}</div> : null}
                            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{item.category.replaceAll("_", " ")} · {item.responsibleParty === "provider" ? "external provider" : item.responsibleParty}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="Setup status unavailable"
                      description="Retry the client workspace to load readiness checks."
                    />
                  )}
                </Section>
                {isOwner && usagePolicy ? (
                  <Section
                    title="Usage and cost safety limits"
                    subtitle="The platform warns at the configured percentage and pauses automation at a hard limit."
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ["SMS per hour", "maxSmsPerHour"],
                        ["SMS per day", "maxSmsPerDay"],
                        ["Emails per hour", "maxEmailsPerHour"],
                        ["Emails per day", "maxEmailsPerDay"],
                        ["AI calls per day", "maxAiCallsPerDay"],
                        ["New leads per hour", "maxLeadsPerHour"],
                        ["Warning percentage", "warningPercentage"],
                        ["Daily cost warning (USD)", "warningCostThresholdUsd"],
                        ["Daily hard cost stop (USD)", "hardCostThresholdUsd"],
                      ].map(([labelText, key]) => (
                        <label key={key} className="space-y-2 text-sm">
                          <span className="font-medium">{labelText}</span>
                          <Input
                            type="number"
                            min={key === "warningPercentage" ? 50 : 0}
                            max={key === "warningPercentage" ? 99 : undefined}
                            step={key.includes("Cost") || key.includes("cost") ? "0.01" : "1"}
                            value={String(usagePolicy[key as keyof UsagePolicy])}
                            onChange={(event) =>
                              setUsagePolicy((current) =>
                                current
                                  ? { ...current, [key]: Number(event.target.value) }
                                  : current,
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="max-w-xs"
                        placeholder="Controlled SMS recipient"
                        value={testSmsRecipient}
                        onChange={(event) => setTestSmsRecipient(event.target.value)}
                      />
                      <Input
                        className="max-w-xs"
                        type="email"
                        placeholder="Controlled email recipient"
                        value={testEmailRecipient}
                        onChange={(event) => setTestEmailRecipient(event.target.value)}
                      />
                      <Button variant="outline" onClick={() => void saveUsagePolicy()}>
                        Save safety limits
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!readiness?.testingReady || selectedTenant.lifecycleStatus === "TESTING"}
                        onClick={() => void startTesting()}
                      >
                        {selectedTenant.lifecycleStatus === "TESTING" ? "Testing mode active" : "Start controlled testing"}
                      </Button>
                    </div>
                    {!readiness?.testingReady && readiness?.testingBlockers?.length ? (
                      <p className="text-xs text-muted-foreground">
                        Testing is blocked by: {readiness.testingBlockers.map((item) => item.label).join("; ")}.
                      </p>
                    ) : null}
                  </Section>
                ) : null}
                <Section
                  title="Launch review"
                  subtitle="Provider callbacks and controlled test runs record technical evidence automatically. Use backfill only for historical externally observed evidence."
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button variant="outline" onClick={() => void recordEvidence({ operatorApproved: true })}>
                      Optional final owner approval
                    </Button>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="text-sm font-medium">Controlled end-to-end test</div>
                      <p className="text-xs text-muted-foreground">Reference the controlled test lead or test run after intake, routing, conversation storage, and outbound delivery are verified.</p>
                      <Input
                        placeholder="Test lead or run reference"
                        value={technicalEvidenceValue("endToEnd")}
                        onChange={(event) => updateTechnicalEvidence("endToEnd", event.target.value)}
                      />
                      <Button
                        variant="outline"
                        disabled={!technicalEvidenceValue("endToEnd").trim()}
                        onClick={() => void recordEvidence({
                          testLeadCompletedAt: new Date().toISOString(),
                          providerTests: { endToEndTestReference: technicalEvidenceValue("endToEnd").trim() },
                        })}
                      >
                        Record completed test
                      </Button>
                    </div>
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="text-sm font-medium">Provider-failure visibility test</div>
                      <p className="text-xs text-muted-foreground">Authenticated failure callbacks record this automatically. Use a reference only when backfilling a separately observed controlled test.</p>
                      <Input
                        placeholder="Failure event or test reference"
                        value={technicalEvidenceValue("providerFailure")}
                        onChange={(event) => updateTechnicalEvidence("providerFailure", event.target.value)}
                      />
                      <Button
                        variant="outline"
                        disabled={!technicalEvidenceValue("providerFailure").trim()}
                        onClick={() => void recordEvidence({
                          providerRejectionTestedAt: new Date().toISOString(),
                          providerTests: { providerRejectionReference: technicalEvidenceValue("providerFailure").trim() },
                        })}
                      >
                        Record observed failure
                      </Button>
                    </div>
                    {readiness?.externalProviderApprovals.twilio.required ? (
                      <div className="space-y-2 rounded-md border p-3">
                        <div className="text-sm font-medium">Twilio external approval</div>
                        <p className="text-xs text-muted-foreground">Current status: {readiness.externalProviderApprovals.twilio.status.replaceAll("_", " ")}. RealtyTechAI submits and polls Trust Hub/A2P automatically; a provider rejection becomes a client-correctable exception.</p>
                      </div>
                    ) : null}
                    {readiness?.externalProviderApprovals.sendgrid.required ? (
                      <div className="space-y-2 rounded-md border p-3">
                        <div className="text-sm font-medium">SendGrid external verification</div>
                        <p className="text-xs text-muted-foreground">Current status: {readiness.externalProviderApprovals.sendgrid.status.replaceAll("_", " ")}. The platform-authenticated sending and reply domains are reused securely; tenant credentials are never required.</p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      placeholder="Reference the client's written launch approval"
                      value={evidence[selectedTenant.id] || ""}
                      onChange={(event) =>
                        setEvidence((current) => ({ ...current, [selectedTenant.id]: event.target.value }))
                      }
                    />
                    <Button
                      variant="outline"
                      disabled={!evidence[selectedTenant.id]?.trim()}
                      onClick={() =>
                        void recordEvidence({
                          clientApprovedAt: new Date().toISOString(),
                          clientApprovalEvidence: evidence[selectedTenant.id].trim(),
                        })
                      }
                    >
                      Save approval
                    </Button>
                  </div>
                  {isOwner ? (
                    <div className="flex flex-wrap gap-2 border-t pt-4">
                      <Button
                        disabled={!readiness?.ready || selectedTenant.serviceState?.state === "suspended"}
                        onClick={() => void changeService("activate")}
                      >
                        Activate service
                      </Button>
                      <Button
                        variant="outline"
                        disabled={selectedTenant.serviceState?.state === "suspended"}
                        onClick={() => void changeService("pause")}
                      >
                        Pause automations
                      </Button>
                    </div>
                  ) : null}
                </Section>
              </TabsContent>

              {isOwner ? (
                <TabsContent value="billing" className="mt-5">
                  <Section title="Client billing" subtitle="Payment state and service eligibility for this client.">
                    <DefinitionRow label="Payment status" value={label(selectedTenant.status)} />
                    <DefinitionRow
                      label="Last payment failure"
                      value={
                        selectedTenant.lastPaymentFailureAt
                          ? new Date(selectedTenant.lastPaymentFailureAt).toLocaleString()
                          : "None recorded"
                      }
                    />
                    <DefinitionRow
                      label="Current period ends"
                      value={
                        selectedTenant.currentPeriodEnd
                          ? new Date(selectedTenant.currentPeriodEnd).toLocaleDateString()
                          : "Not available"
                      }
                    />
                    <DefinitionRow
                      label="Service effect"
                      value={selectedTenant.serviceState?.reason || "No billing restriction is recorded."}
                    />
                  </Section>
                </TabsContent>
              ) : null}

              <TabsContent value="activity" className="mt-5">
                <Section title="Client activity" subtitle="Meaningful workspace and service events.">
                  <ActivityRow title="Client workspace updated" timestamp={selectedTenant.updatedAt} />
                  {selectedTenant.serviceSuspendedAt ? (
                    <ActivityRow
                      title="Services suspended"
                      detail={selectedTenant.serviceSuspensionReason || undefined}
                      timestamp={selectedTenant.serviceSuspendedAt}
                    />
                  ) : null}
                  {selectedTenant.serviceRestoredAt ? (
                    <ActivityRow title="Services restored" timestamp={selectedTenant.serviceRestoredAt} />
                  ) : null}
                  {clientCommunications.slice(0, 5).map((item) => (
                    <ActivityRow
                      key={item.id}
                      title={`${label(item.channel)} ${label(item.direction)}`}
                      detail={`${item.leadName} · ${label(item.status)}`}
                      timestamp={item.createdAt}
                    />
                  ))}
                </Section>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="space-y-5">
            {isOwner && showCreateClient ? (
              <Card>
                <CardHeader>
                  <CardTitle>{sourceApplicationId ? "Create client from accepted inquiry" : "Add client"}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Creates a private inactive workspace. Service remains off until setup and launch approval are
                    complete.
                  </p>
                </CardHeader>
                <CardContent>
                  <form className="grid gap-3 lg:grid-cols-[1fr_1fr_220px_auto] lg:items-end" onSubmit={createClient}>
                    <FieldLabel label="Business name">
                      <Input
                        required
                        minLength={2}
                        maxLength={120}
                        value={businessName}
                        onChange={(event) => setBusinessName(event.target.value)}
                      />
                    </FieldLabel>
                    <FieldLabel label="Owner email">
                      <Input
                        required
                        type="email"
                        value={ownerEmail}
                        onChange={(event) => setOwnerEmail(event.target.value)}
                      />
                    </FieldLabel>
                    <OwnerSelect value={newClientOwner} operators={operators} onChange={setNewClientOwner} />
                    <div className="flex gap-2">
                      <Button disabled={creatingClient}>{creatingClient ? "Creating…" : "Create client"}</Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setShowCreateClient(false)
                          setSourceApplicationId(null)
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            {clientSetup ? (
              <Card className="border-emerald-500/40">
                <CardHeader>
                  <CardTitle>Secure client handoff</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Send the verification link and temporary password through separate channels, then remove them from
                    your notes.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <CopyRow label="Owner email" value={clientSetup.owner.email} />
                  <CopyRow label="Temporary password" value={clientSetup.temporaryPassword} />
                  <CopyRow label="Verification link" value={clientSetup.verifyLink} />
                  <p className="rounded-md bg-muted p-3 text-sm">
                    {clientSetup.verificationEmailSent
                      ? "Verification email sent successfully."
                      : "System email is not connected; send the verification link manually."}
                  </p>
                  <Button variant="outline" onClick={() => setClientSetup(null)}>
                    I saved the handoff
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardContent className="p-4">
                <div className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_220px_220px_auto]">
                  <SearchInput value={search} onChange={setSearch} placeholder="Search clients" />
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={clientFilter}
                    onChange={(event) => setClientFilter(event.target.value)}
                    aria-label="Filter clients by status"
                  >
                    <option value="needs_attention">Needs attention</option>
                    <option value="all">All clients</option>
                    <option value="active">Active</option>
                    <option value="setup_incomplete">Setup incomplete</option>
                    <option value="payment_overdue">Payment overdue</option>
                    <option value="suspended">Suspended</option>
                    <option value="integration_issue">Integration issue</option>
                  </select>
                  <OwnerFilter value={ownerFilter} operators={operators} onChange={setOwnerFilter} />
                  {isOwner && !showCreateClient ? (
                    <Button onClick={() => setShowCreateClient(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add client
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {sectionLoading.clients && !tenants.length ? (
              <LoadingTable />
            ) : filteredTenants.length ? (
              <>
                <Card className="hidden md:block">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Client</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>Onboarding</TableHead>
                          <TableHead>Lead source</TableHead>
                          {isOwner ? <TableHead>Payment</TableHead> : null}
                          <TableHead>Last activity</TableHead>
                          <TableHead>Assigned staff</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTenants.map((tenant) => {
                          const integration = integrationState(tenant.id)
                          return (
                            <TableRow key={tenant.id}>
                              <TableCell>
                                <button
                                  className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  onClick={() => switchView("clients", tenant.id, "overview")}
                                >
                                  {tenant.name}
                                </button>
                              </TableCell>
                              <TableCell>
                                <StatusBadge
                                  value={tenant.serviceState?.label || tenant.lifecycleStatus}
                                  tone={
                                    tenant.serviceState?.state === "suspended"
                                      ? "danger"
                                      : tenant.lifecycleStatus === "ACTIVE"
                                        ? "success"
                                        : "neutral"
                                  }
                                />
                              </TableCell>
                              <TableCell>{onboardingStatus(tenant)}</TableCell>
                              <TableCell>
                                <StatusBadge
                                  value={integration.label}
                                  tone={integration.issue ? "warning" : "success"}
                                />
                              </TableCell>
                              {isOwner ? <TableCell>{label(tenant.status)}</TableCell> : null}
                              <TableCell>{age(tenant.updatedAt)}</TableCell>
                              <TableCell>{operatorName(tenant.assignedOperatorId)}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => switchView("clients", tenant.id, "overview")}
                                >
                                  Open
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <div className="space-y-3 md:hidden">
                  {filteredTenants.map((tenant) => {
                    const integration = integrationState(tenant.id)
                    return (
                      <Card key={tenant.id}>
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{tenant.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {operatorName(tenant.assignedOperatorId)}
                              </div>
                            </div>
                            <StatusBadge
                              value={tenant.serviceState?.label || tenant.lifecycleStatus}
                              tone={tenant.serviceState?.state === "suspended" ? "danger" : "neutral"}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <DefinitionRow label="Onboarding" value={onboardingStatus(tenant)} compact />
                            <DefinitionRow label="Lead source" value={integration.label} compact />
                          </div>
                          <Button
                            className="w-full"
                            variant="outline"
                            onClick={() => switchView("clients", tenant.id, "overview")}
                          >
                            Open client
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </>
            ) : (
              <EmptyState
                title="No clients match these filters"
                description="Change the status, owner, or search filter."
              />
            )}
          </div>
        )
      ) : null}

      {view === "leads" ? (
        <div className="space-y-5">
          <Card>
            <CardContent className="p-4">
              <div className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_220px_220px]">
                <SearchInput value={search} onChange={setSearch} placeholder="Search leads" />
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={leadFilter}
                  onChange={(event) => setLeadFilter(event.target.value)}
                  aria-label="Filter leads by status"
                >
                  <option value="requires_response">Requires response</option>
                  <option value="all">All leads</option>
                  <option value="new">New</option>
                  <option value="appointment_scheduled">Appointment scheduled</option>
                  <option value="follow_up_due">Follow-up due</option>
                  <option value="paused">Paused</option>
                  <option value="opted_out">Opted out</option>
                  <option value="lost">Lost</option>
                </select>
                <OwnerFilter value={ownerFilter} operators={operators} onChange={setOwnerFilter} />
              </div>
            </CardContent>
          </Card>

          {selectedApplication ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{selectedApplication.company || selectedApplication.name}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedApplication.email} · {selectedApplication.phone || "No phone"}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Close application details"
                    onClick={() => setSelectedApplicationId(null)}
                  >
                    ×
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">{selectedApplication.message}</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <FieldLabel label="Stage">
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={selectedApplication.status}
                      onChange={(event) =>
                        void patchApplication(selectedApplication, {
                          status: event.target.value,
                          assignedOperatorId: selectedApplication.assignedOperatorId || null,
                          operatorNotes: notes[selectedApplication.id] || "",
                        })
                      }
                    >
                      {["new", "reviewing", "qualified", "consultation_booked", "accepted", "declined"].map(
                        (status) => (
                          <option key={status} value={status}>
                            {label(status)}
                          </option>
                        ),
                      )}
                    </select>
                  </FieldLabel>
                  <OwnerSelect
                    value={selectedApplication.assignedOperatorId || ""}
                    operators={operators}
                    onChange={(value) =>
                      void patchApplication(selectedApplication, {
                        assignedOperatorId: value || null,
                        operatorNotes: notes[selectedApplication.id] || "",
                      })
                    }
                  />
                  <FieldLabel label="Internal notes">
                    <Input
                      value={notes[selectedApplication.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [selectedApplication.id]: event.target.value }))
                      }
                      onBlur={() => {
                        if ((notes[selectedApplication.id] || "") !== (selectedApplication.operatorNotes || ""))
                          void patchApplication(selectedApplication, {
                            operatorNotes: notes[selectedApplication.id] || "",
                          })
                      }}
                    />
                  </FieldLabel>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isOwner ? (
                    <Button
                      onClick={() => prepareClient(selectedApplication)}
                      disabled={selectedApplication.status === "declined"}
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Create client
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() =>
                      void apiFetch(`/admin/applications/${selectedApplication.id}/onboarding-task`, {
                        method: "POST",
                      }).then(() => loadDataSection("tasks", true))
                    }
                  >
                    Create follow-up task
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {sectionLoading.leadAttention && sectionLoading.applications && !leadRows.length ? (
            <LoadingTable />
          ) : leadRows.length ? (
            <>
              <Card className="hidden md:block">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lead</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead className="hidden 2xl:table-cell">Source</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead>Communication</TableHead>
                        <TableHead className="min-w-56">Next action</TableHead>
                        <TableHead>Last contact</TableHead>
                        <TableHead className="hidden xl:table-cell">Assigned staff</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leadRows.map((row) => (
                        <TableRow key={`${row.kind}-${row.id}`}>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell>{row.client}</TableCell>
                          <TableCell className="hidden 2xl:table-cell">{label(row.source)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{label(row.stage)}</Badge>
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              value={row.communication}
                              tone={/requires|failed/i.test(row.communication) ? "warning" : "neutral"}
                            />
                          </TableCell>
                          <TableCell className="max-w-72 whitespace-normal text-muted-foreground">
                            {row.nextAction}
                          </TableCell>
                          <TableCell>{age(row.lastContact)}</TableCell>
                          <TableCell className="hidden xl:table-cell">{operatorName(row.owner)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                row.kind === "client"
                                  ? switchView("clients", row.tenantId || undefined, "leads")
                                  : setSelectedApplicationId(row.id)
                              }
                            >
                              {row.kind === "client" ? "Open lead" : "Review"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <div className="space-y-3 md:hidden">
                {leadRows.map((row) => (
                  <Card key={`${row.kind}-${row.id}`}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{row.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {row.client} · {label(row.source)}
                          </div>
                        </div>
                        <StatusBadge
                          value={row.communication}
                          tone={/requires|failed/i.test(row.communication) ? "warning" : "neutral"}
                        />
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Next: </span>
                        {row.nextAction}
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>
                          {label(row.stage)} · {operatorName(row.owner)}
                        </span>
                        <span>{age(row.lastContact)}</span>
                      </div>
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() =>
                          row.kind === "client"
                            ? switchView("clients", row.tenantId || undefined, "leads")
                            : setSelectedApplicationId(row.id)
                        }
                      >
                        {row.kind === "client" ? "Open lead" : "Review inquiry"}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="No leads match these filters"
              description="Change the communication status, owner, or search filter."
            />
          )}

          {handoffs.some((item) => item.status !== "completed") ||
          appointments.some((item) => ["scheduled", "confirmed"].includes(item.status)) ? (
            <div className="grid gap-5 xl:grid-cols-2">
              <Section title="Human response queue" subtitle="Conversations explicitly handed off to a person.">
                {handoffs
                  .filter((item) => item.status !== "completed")
                  .slice(0, 5)
                  .map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div>
                        <div className="text-sm font-medium">
                          {item.lead.fullName} · {item.tenant.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{item.reason}</div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => void patchHandoff(item, "completed")}>
                        Complete
                      </Button>
                    </div>
                  ))}
              </Section>
              <Section title="Upcoming appointments" subtitle="Scheduled client appointments needing oversight.">
                {appointments
                  .filter((item) => ["scheduled", "confirmed"].includes(item.status))
                  .slice(0, 5)
                  .map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div>
                        <div className="text-sm font-medium">
                          {item.lead.fullName} · {item.tenant.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{new Date(item.startsAt).toLocaleString()}</div>
                      </div>
                      <StatusBadge value={item.status} tone={item.status === "confirmed" ? "success" : "neutral"} />
                    </div>
                  ))}
              </Section>
            </div>
          ) : null}
        </div>
      ) : null}

      {view === "onboarding" ? (
        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Client progress</CardTitle>
              <p className="text-sm text-muted-foreground">Choose a client to see exact blockers.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {onboardingClients.length ? (
                onboardingClients.map((tenant) => (
                  <button
                    key={tenant.id}
                    className={cn(
                      "w-full rounded-md border p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                      selectedTenant?.id === tenant.id && "border-primary bg-primary/5",
                    )}
                    onClick={() => switchView("onboarding", tenant.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{tenant.name}</span>
                      <StatusBadge
                        value={onboardingStatus(tenant)}
                        tone={onboardingStatus(tenant) === "Blocked" ? "danger" : "neutral"}
                      />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Assigned: {operatorName(tenant.assignedOperatorId)}
                    </div>
                  </button>
                ))
              ) : (
                <EmptyState
                  title="No clients are onboarding"
                  description="New client workspaces appear here until launch."
                  compact
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>{selectedTenant?.name || "Select a client"}</CardTitle>
                  {selectedTenant ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {readiness?.ready
                        ? "Ready for final review"
                        : `${readiness?.blockers.length || 0} setup blocker(s)`}
                    </p>
                  ) : null}
                </div>
                {selectedTenant ? (
                  <Button variant="outline" onClick={() => switchView("clients", selectedTenant.id, "setup")}>
                    Open full setup
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {clientDetailsLoading ? (
                <LoadingRows />
              ) : selectedTenant && readiness ? (
                <div className="space-y-3">
                  {onboardingGroups.map((group) => {
                    const state = onboardingGroupState(group, readiness)
                    return (
                      <div
                        key={group.label}
                        className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-start gap-3">
                          {state === "Complete" ? (
                            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                          ) : (
                            <CircleAlert className="mt-0.5 h-5 w-5 text-amber-600" />
                          )}
                          <div>
                            <div className="font-medium">{group.label}</div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {state === "Complete"
                                ? "All required checks in this step pass."
                                : readiness.blockers.find((item) => group.keys.includes(item.key))?.nextAction ||
                                  "This step still needs review."}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge
                            value={state}
                            tone={state === "Blocked" ? "danger" : state === "Complete" ? "success" : "warning"}
                          />
                          {state !== "Complete" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => switchView("clients", selectedTenant.id, "setup")}
                            >
                              Resolve
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState
                  title="Choose a client"
                  description="Exact onboarding steps and direct actions will appear here."
                />
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {view === "tasks" ? (
        <div className="space-y-5">
          <Card>
            <CardContent className="p-4">
              <div className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_220px_220px]">
                <SearchInput value={search} onChange={setSearch} placeholder="Search tasks" />
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={taskFilter}
                  onChange={(event) => setTaskFilter(event.target.value)}
                  aria-label="Filter tasks by status"
                >
                  <option value="open">Open work</option>
                  <option value="all">All tasks</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="resolved">Resolved</option>
                </select>
                <OwnerFilter value={ownerFilter} operators={operators} onChange={setOwnerFilter} />
              </div>
            </CardContent>
          </Card>
          {sectionLoading.tasks && !tasks.length ? (
            <LoadingTable />
          ) : filteredTasks.length ? (
            <>
              <Card className="hidden md:block">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Task</TableHead>
                        <TableHead>Related client</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Due date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTasks.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="max-w-96 whitespace-normal">
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</div>
                          </TableCell>
                          <TableCell>{tenantName(item.tenantId)}</TableCell>
                          <TableCell>
                            <CompactOwnerSelect
                              value={item.assignedOperatorId || ""}
                              operators={operators}
                              onChange={(value) => void patchTask(item, { assignedOperatorId: value || null })}
                            />
                          </TableCell>
                          <TableCell>
                            <SeverityBadge
                              severity={
                                item.priority === "critical" ? "critical" : item.priority === "high" ? "high" : "medium"
                              }
                              label={item.priority}
                            />
                          </TableCell>
                          <TableCell>{item.dueAt ? new Date(item.dueAt).toLocaleString() : "Not set"}</TableCell>
                          <TableCell>
                            <StatusBadge
                              value={item.status}
                              tone={
                                item.status === "blocked"
                                  ? "danger"
                                  : item.status === "resolved"
                                    ? "success"
                                    : "neutral"
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" aria-label={`Update ${item.title}`}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {(["open", "in_progress", "blocked", "resolved"] as const).map((status) => (
                                  <DropdownMenuItem
                                    key={status}
                                    onSelect={() =>
                                      void patchTask(item, {
                                        status,
                                        evidenceNote: evidence[item.id] ?? item.evidenceNote ?? null,
                                      })
                                    }
                                  >
                                    {label(status)}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <div className="space-y-3 md:hidden">
                {filteredTasks.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{item.title}</div>
                          <div className="text-sm text-muted-foreground">{tenantName(item.tenantId)}</div>
                        </div>
                        <SeverityBadge
                          severity={
                            item.priority === "critical" ? "critical" : item.priority === "high" ? "high" : "medium"
                          }
                          label={item.priority}
                        />
                      </div>
                      <p className="line-clamp-3 text-sm text-muted-foreground">{item.description}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <DefinitionRow
                          label="Due"
                          value={item.dueAt ? new Date(item.dueAt).toLocaleDateString() : "Not set"}
                          compact
                        />
                        <DefinitionRow label="Status" value={label(item.status)} compact />
                      </div>
                      <CompactOwnerSelect
                        value={item.assignedOperatorId || ""}
                        operators={operators}
                        onChange={(value) => void patchTask(item, { assignedOperatorId: value || null })}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void patchTask(item, { status: "in_progress" })}
                        >
                          Start task
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            void patchTask(item, {
                              status: "resolved",
                              evidenceNote: item.evidenceNote || "Resolved by operator",
                            })
                          }
                        >
                          Resolve
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="No tasks match these filters"
              description="Change the status, owner, or search filter."
            />
          )}
        </div>
      ) : null}

      {view === "support" ? (
        <div className="space-y-5">
          <Card>
            <CardContent className="p-4">
              <div className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_220px_220px]">
                <SearchInput value={search} onChange={setSearch} placeholder="Search support" />
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={supportFilter}
                  onChange={(event) => setSupportFilter(event.target.value)}
                  aria-label="Filter support by status"
                >
                  <option value="open">Open requests</option>
                  <option value="all">All requests</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <OwnerFilter value={ownerFilter} operators={operators} onChange={setOwnerFilter} />
              </div>
            </CardContent>
          </Card>
          {sectionLoading.support && !support.length ? (
            <LoadingTable />
          ) : filteredSupport.length ? (
            <>
              <Card className="hidden md:block">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Request</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Age</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSupport.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="max-w-96 whitespace-normal">
                            <div className="font-medium">{item.subject}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.message}</div>
                          </TableCell>
                          <TableCell>{tenantName(item.tenantId)}</TableCell>
                          <TableCell>{label(item.category || "General")}</TableCell>
                          <TableCell>
                            <SeverityBadge
                              severity={
                                item.severity === "urgent" ? "critical" : item.severity === "high" ? "high" : "medium"
                              }
                              label={item.severity}
                            />
                          </TableCell>
                          <TableCell>
                            <CompactOwnerSelect
                              value={item.assignedOperatorId || ""}
                              operators={operators}
                              onChange={(value) => void patchSupport(item, { assignedOperatorId: value || null })}
                            />
                          </TableCell>
                          <TableCell>{age(item.createdAt)}</TableCell>
                          <TableCell>
                            <StatusBadge
                              value={item.status}
                              tone={
                                item.status === "resolved"
                                  ? "success"
                                  : item.severity === "urgent"
                                    ? "danger"
                                    : "neutral"
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {item.status === "open" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void patchSupport(item, { status: "acknowledged" })}
                                >
                                  Acknowledge
                                </Button>
                              ) : null}
                              {!["resolved", "closed"].includes(item.status) ? (
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    void patchSupport(item, {
                                      status: "resolved",
                                      resolutionNote:
                                        evidence[item.id] ?? item.resolutionNote ?? "Resolved by operator",
                                    })
                                  }
                                >
                                  Resolve
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <div className="space-y-3 md:hidden">
                {filteredSupport.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{item.subject}</div>
                          <div className="text-sm text-muted-foreground">
                            {tenantName(item.tenantId)} · {label(item.category || "General")}
                          </div>
                        </div>
                        <SeverityBadge
                          severity={
                            item.severity === "urgent" ? "critical" : item.severity === "high" ? "high" : "medium"
                          }
                          label={item.severity}
                        />
                      </div>
                      <p className="line-clamp-3 text-sm text-muted-foreground">{item.message}</p>
                      <div className="flex items-center justify-between gap-3">
                        <StatusBadge
                          value={item.status}
                          tone={
                            item.status === "resolved" ? "success" : item.severity === "urgent" ? "danger" : "neutral"
                          }
                        />
                        <span className="text-xs text-muted-foreground">{age(item.createdAt)}</span>
                      </div>
                      <CompactOwnerSelect
                        value={item.assignedOperatorId || ""}
                        operators={operators}
                        onChange={(value) => void patchSupport(item, { assignedOperatorId: value || null })}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        {item.status === "open" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void patchSupport(item, { status: "acknowledged" })}
                          >
                            Acknowledge
                          </Button>
                        ) : (
                          <div />
                        )}
                        {!["resolved", "closed"].includes(item.status) ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              void patchSupport(item, {
                                status: "resolved",
                                resolutionNote: item.resolutionNote || "Resolved by operator",
                              })
                            }
                          >
                            Resolve
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="No support requests match these filters"
              description="Change the status, owner, or search filter."
            />
          )}
        </div>
      ) : null}

      {view === "billing" && isOwner ? (
        <div className="space-y-5">
          {sectionLoading.billing && !billing ? (
            <OverviewSkeleton />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label="Active recurring revenue"
                  value={billing ? currency(billing.mrrByCurrency?.usd ?? 0) : null}
                  detail="Live active subscriptions"
                />
                <Metric
                  label="Collected this month"
                  value={
                    billing
                      ? currency(
                          billing.live.collectedThisMonth.find((row) => row.currency === "usd")?.amountCents ?? 0,
                        )
                      : null
                  }
                  detail="Payments minus refunds"
                />
                <Metric
                  label="Past-due clients"
                  value={billing?.pastDueClients ?? null}
                  detail="Require billing action"
                  warning={Boolean(billing?.pastDueClients)}
                />
                <Metric
                  label="Failed payments (30d)"
                  value={billing?.live.eventCounts30?.payment_failed ?? null}
                  detail="Verified live events"
                  warning={Boolean(billing?.live.eventCounts30?.payment_failed)}
                />
              </div>
              <Section title="Past-due and suspended clients" subtitle="Open the client before changing service state.">
                {tenants.filter((tenant) =>
                  ["payment_overdue", "grace_period", "suspended"].includes(tenant.serviceState?.state || ""),
                ).length ? (
                  tenants
                    .filter((tenant) =>
                      ["payment_overdue", "grace_period", "suspended"].includes(tenant.serviceState?.state || ""),
                    )
                    .map((tenant) => (
                      <div
                        key={tenant.id}
                        className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="font-medium">{tenant.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {tenant.serviceState?.reason || label(tenant.status)}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => switchView("clients", tenant.id, "billing")}>
                          Review client
                        </Button>
                      </div>
                    ))
                ) : (
                  <EmptyState
                    title="No billing actions"
                    description="No client is currently past due or suspended."
                    compact
                  />
                )}
              </Section>
              {billing ? <BillingActivity billing={billing} /> : null}
              {billing?.test.collectedThisMonth.length ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                  Stripe test-mode activity is excluded from live revenue:{" "}
                  {billing.test.collectedThisMonth
                    .map((row) => `${currency(row.amountCents, row.currency)} ${row.currency.toUpperCase()}`)
                    .join(", ")}
                  .
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {view === "health" && isOwner ? (
        <div className="space-y-5">
          {sectionLoading.health && !health ? (
            <LoadingTable />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <HealthTile
                label="Database"
                status={health?.dbConnected ? "Operational" : "Unavailable"}
                healthy={Boolean(health?.dbConnected)}
                detail="Primary application data store"
              />
              <HealthTile
                label="Messaging"
                status={health ? (health.failedMessages24h ? "Degraded" : "Operational") : "Unavailable"}
                healthy={Boolean(health && !health.failedMessages24h)}
                detail={
                  health
                    ? `${health.failedMessages24h} failed of ${health.totalMessages24h} messages in 24 hours`
                    : "Health data unavailable"
                }
              />
              <HealthTile
                label="Email"
                status={health?.environment?.systemEmail?.status === "up" ? "Operational" : "Configuration required"}
                healthy={health?.environment?.systemEmail?.status === "up"}
                detail="System and client email delivery"
              />
              <HealthTile
                label="Billing"
                status={health?.environment?.billing?.status === "up" ? "Operational" : "Configuration required"}
                healthy={health?.environment?.billing?.status === "up"}
                detail="Stripe payment processing"
              />
              <HealthTile
                label="Automation worker"
                status={aiOverview?.platformPaused ? "Paused" : sectionErrors.ai ? "Unavailable" : "Operational"}
                healthy={Boolean(aiOverview && !aiOverview.platformPaused)}
                detail={
                  aiOverview?.platformPaused
                    ? aiOverview.platformPauseReason || "Global AI pause is active"
                    : "Guarded AI response processing"
                }
              />
              <HealthTile
                label="Device notifications"
                status={health?.environment?.devicePush?.status === "up" ? "Operational" : "Configuration required"}
                healthy={health?.environment?.devicePush?.status === "up"}
                detail="Admin and client push notifications"
              />
            </div>
          )}
          <Section
            title="Owner exceptions"
            subtitle="Healthy clients need no review; only unresolved exceptions appear here."
          >
            {ownerExceptions?.status === "HEALTHY" ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4">
                <StatusBadge value="HEALTHY · NO ACTION" tone="success" />
              </div>
            ) : ownerExceptions?.exceptions.length ? (
              ownerExceptions.exceptions.map((item) => (
                <div key={item.id} className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{tenantName(item.tenantId || "")} · {label(item.category)}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.problem}</p>
                    </div>
                    <SeverityBadge
                      severity={item.severity === "critical" ? "critical" : item.severity === "high" ? "high" : "medium"}
                      label={item.severity}
                    />
                  </div>
                  {item.providerError ? <p className="text-sm"><span className="font-medium">Provider:</span> {item.providerError}</p> : null}
                  <p className="text-sm"><span className="font-medium">Recommended action:</span> {item.recommendedAction}</p>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>Automatic attempts: {item.automaticAttempts.reduce((sum, attempt) => sum + attempt.attempts, 0)}</span>
                    <span>First detected: {new Date(item.firstDetected).toLocaleString()}</span>
                    <span>Last checked: {new Date(item.lastChecked).toLocaleString()}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Exception status is loading.</p>
            )}
          </Section>
          <Section
            title="Production setup checker"
            subtitle="One-time platform credentials, infrastructure, and verification evidence. Secrets are never displayed."
          >
            {setupChecker ? (
              Object.entries(setupChecker.groups).map(([group, items]) => (
                <div key={group} className="rounded-md border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="font-medium">{label(group)}</div>
                    <StatusBadge
                      value={items.every((item) => item.status === "ready") ? "Ready" : "Action required"}
                      tone={items.every((item) => item.status === "ready") ? "success" : "warning"}
                    />
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.label} className="flex items-start justify-between gap-4 text-sm">
                        <span>{item.label}</span>
                        <span className="max-w-xl text-right text-muted-foreground">
                          {item.status === "ready" ? "Configured" : item.nextAction || "Action required"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Setup checks are loading.</p>
            )}
          </Section>
        </div>
      ) : null}

      {view === "audit" && isOwner ? (
        <div className="space-y-5">
          {sectionLoading.audit && !auditLogs.length ? (
            <LoadingTable />
          ) : auditLogs.length ? (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.slice(0, auditLimit).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell>
                        <TableCell>{item.actorEmail || item.actorId}</TableCell>
                        <TableCell>
                          <div className="font-medium">{label(item.action)}</div>
                          <div className="text-xs text-muted-foreground">{item.path}</div>
                        </TableCell>
                        <TableCell>{item.method}</TableCell>
                        <TableCell>
                          <StatusBadge
                            value={String(item.statusCode)}
                            tone={item.statusCode < 400 ? "success" : "danger"}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <EmptyState title="No audit events" description="Recorded administrative changes will appear here." />
          )}
          {auditLogs.length > auditLimit ? (
            <div className="text-center">
              <Button variant="outline" onClick={() => setAuditLimit((current) => current + 25)}>
                Load 25 more
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {view === "settings" && isOwner ? (
        <Tabs defaultValue="automation" className="space-y-5">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="automation">Automation</TabsTrigger>
            <TabsTrigger value="messaging">Messaging</TabsTrigger>
            <TabsTrigger value="booking">Booking</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
          </TabsList>
          <TabsContent value="automation" className="space-y-5">
            <Card className={aiOverview?.platformPaused ? "border-destructive/50" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  Global AI control
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Stops AI generation and queued AI sends while keeping manual inbox access available.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <StatusBadge
                    value={
                      sectionErrors.ai || !aiOverview
                        ? "Status unavailable"
                        : aiOverview.platformPaused
                          ? "All AI paused"
                          : "AI available"
                    }
                    tone={aiOverview?.platformPaused ? "danger" : aiOverview ? "success" : "warning"}
                  />
                  {aiOverview?.platformPauseReason ? (
                    <p className="mt-2 text-sm text-muted-foreground">{aiOverview.platformPauseReason}</p>
                  ) : null}
                </div>
                {aiOverview && !sectionErrors.ai ? (
                  <Button
                    variant={aiOverview.platformPaused ? "default" : "destructive"}
                    onClick={() =>
                      aiOverview.platformPaused ? void setPlatformAiPause(false) : setConfirmAiPause(true)
                    }
                  >
                    {aiOverview.platformPaused ? "Clear platform pause" : "Pause all AI"}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
            <Section title="Client AI status" subtitle="Approved mode, current state, and usage by client.">
              {aiOverview?.clients.length ? (
                aiOverview.clients.map((client) => {
                  const percent = Math.min(
                    Math.round((client.usage / Math.max(client.monthlyUsageLimit, 1)) * 100),
                    100,
                  )
                  return (
                    <div
                      key={client.tenantId}
                      className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_auto_auto] md:items-center"
                    >
                      <div>
                        <div className="font-medium">{client.tenantName}</div>
                        <div className="text-xs text-muted-foreground">
                          {label(client.mode)} · configuration {label(client.configurationApprovalStatus)}
                        </div>
                      </div>
                      <StatusBadge
                        value={client.aiEnabled && !client.aiPaused ? "Active" : "Paused"}
                        tone={client.aiEnabled && !client.aiPaused ? "success" : "neutral"}
                      />
                      <div className="text-sm text-muted-foreground md:text-right">
                        {percent}% of limit
                        {client.estimatedCostUsd
                          ? ` · ${client.estimatedCostUsd.toLocaleString(undefined, { style: "currency", currency: "USD" })}`
                          : ""}
                      </div>
                    </div>
                  )
                })
              ) : (
                <EmptyState
                  title="No client AI configuration"
                  description="Client AI settings appear after configuration begins."
                />
              )}
            </Section>
          </TabsContent>
          <TabsContent value="messaging">
            <ManagedIntegrations />
          </TabsContent>
          <TabsContent value="booking">
            <SalesBookingSettings />
          </TabsContent>
          <TabsContent value="staff">
            <Section title="Staff access" subtitle="Only verified, active users can receive platform staff access.">
              {platformUsers.length ? (
                platformUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="font-medium">{user.email}</div>
                      <div className="text-sm text-muted-foreground">
                        {user.platformRole ? label(user.platformRole) : "Client workspace user"} ·{" "}
                        {user.isEmailVerified ? "Verified" : "Not verified"}
                      </div>
                    </div>
                    {user.platformRole === "super_admin" ? (
                      <Badge>Owner</Badge>
                    ) : user.accessManagedByEnvironment ? (
                      <Badge variant="secondary">Managed by environment</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant={user.platformRole === "staff" ? "outline" : "default"}
                        disabled={!user.isActive || !user.isEmailVerified}
                        onClick={() => void setStaffAccess(user, user.platformRole !== "staff")}
                      >
                        {user.platformRole === "staff" ? "Remove staff access" : "Make staff"}
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <EmptyState title="No users available" description="Verified users will appear here." />
              )}
            </Section>
          </TabsContent>
        </Tabs>
      ) : null}

      <ServiceControlDialog
        key={serviceAction || "closed"}
        action={serviceAction}
        clientName={selectedTenant?.name || "this client"}
        busy={serviceBusy}
        error={serviceError}
        onOpenChange={(open) => {
          if (!open && !serviceBusy) setServiceAction(null)
        }}
        onConfirm={(reason) => void confirmServiceAction(reason)}
      />

      <AlertDialog open={confirmAiPause} onOpenChange={setConfirmAiPause}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause all AI activity?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops AI generation and cancels queued AI replies across every client. Manual messaging, inboxes,
              leads, and appointments remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void setPlatformAiPause(true)}
            >
              Pause all AI
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function InlineNotice({ tone, text, onDismiss }: { tone: "error" | "success"; text: string; onDismiss: () => void }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border p-3 text-sm",
        tone === "error"
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <span>{text}</span>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
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
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="flex-1">
          <div className="font-medium">Some live data is unavailable</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Available sections remain usable. Retry only the affected source.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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
      </div>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading overview">
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  )
}

function ClientWorkspaceSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-2" aria-label="Loading client workspace">
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-3" aria-label="Loading content">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  )
}

function LoadingTable() {
  return (
    <Card aria-label="Loading table">
      <CardContent className="space-y-3 p-4">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}

function PlatformStatusBanner({
  aiOverview,
  aiUnavailable,
  health,
  healthUnavailable,
  suspendedClients,
  onOpenSettings,
  onOpenHealth,
  onOpenClients,
}: {
  aiOverview: AiOverview | null
  aiUnavailable: boolean
  health: SystemHealth | null
  healthUnavailable: boolean
  suspendedClients: Tenant[]
  onOpenSettings: () => void
  onOpenHealth: () => void
  onOpenClients: () => void
}) {
  let title = "Platform operating normally"
  let detail = "No critical platform issue is currently reported."
  let action = ""
  let onClick: (() => void) | null = null
  let tone: "normal" | "warning" | "critical" = "normal"

  if (healthUnavailable || aiUnavailable) {
    title = "Platform status is incomplete"
    detail = "One or more health sources could not be checked."
    action = healthUnavailable ? "Review system health" : "Review AI settings"
    onClick = healthUnavailable ? onOpenHealth : onOpenSettings
    tone = "warning"
  } else if (health && (!health.dbConnected || health.failedMessages24h > 0)) {
    title = health.dbConnected ? "Message delivery is degraded" : "Critical system-health issue"
    detail = health.dbConnected
      ? `${health.failedMessages24h} message(s) failed in the last 24 hours.`
      : "The application could not confirm database availability."
    action = "Review system health"
    onClick = onOpenHealth
    tone = health.dbConnected ? "warning" : "critical"
  } else if (aiOverview?.platformPaused) {
    title = "Global AI automation is paused"
    detail = aiOverview.platformPauseReason || "Automated AI responses are stopped across all clients."
    action = "Open automation settings"
    onClick = onOpenSettings
    tone = "critical"
  } else if (suspendedClients.length) {
    title = `${suspendedClients.length} client service${suspendedClients.length === 1 ? " is" : "s are"} suspended`
    detail = "Automated messaging and sequences are stopped for affected clients."
    action = "Review suspended clients"
    onClick = onOpenClients
    tone = "warning"
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between",
        tone === "critical" && "border-destructive/50 bg-destructive/5",
        tone === "warning" && "border-amber-500/40 bg-amber-500/10",
        tone === "normal" && "bg-background",
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        {tone === "normal" ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
        ) : tone === "critical" ? (
          <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
        ) : (
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-300" />
        )}
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{detail}</div>
        </div>
      </div>
      {onClick ? (
        <Button size="sm" variant="outline" onClick={onClick}>
          {action}
        </Button>
      ) : null}
    </div>
  )
}

function SummaryCard({ label: title, value, onClick }: { label: string; value: number | null; onClick: () => void }) {
  return (
    <button
      className="rounded-lg border bg-card p-5 text-left shadow-sm outline-none transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      <div className="text-3xl font-semibold">{value ?? "—"}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{title}</span>
        <ChevronRight className="h-4 w-4" />
      </div>
    </button>
  )
}

function SeverityBadge({ severity, label: customLabel }: { severity: PriorityAction["severity"]; label?: string }) {
  const text = customLabel ? label(customLabel) : label(severity)
  if (severity === "critical") return <Badge variant="destructive">{text}</Badge>
  if (severity === "high")
    return (
      <Badge
        className="border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
        variant="outline"
      >
        {text}
      </Badge>
    )
  return <Badge variant="secondary">{text}</Badge>
}

function StatusBadge({
  value,
  tone = "neutral",
}: {
  value: string
  tone?: "success" | "warning" | "danger" | "neutral"
}) {
  if (tone === "danger") return <Badge variant="destructive">{label(value)}</Badge>
  if (tone === "success")
    return (
      <Badge
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/10 dark:text-emerald-200"
        variant="outline"
      >
        {label(value)}
      </Badge>
    )
  if (tone === "warning")
    return (
      <Badge
        className="border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
        variant="outline"
      >
        {label(value)}
      </Badge>
    )
  return <Badge variant="secondary">{label(value)}</Badge>
}

function EmptyState({
  title,
  description,
  compact = false,
}: {
  title: string
  description: string
  compact?: boolean
}) {
  return (
    <div className={cn("rounded-md border border-dashed text-center", compact ? "p-4" : "p-8")}>
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

function DefinitionRow({ label: title, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-4", !compact && "border-b pb-3 last:border-0 last:pb-0")}>
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="text-right text-sm font-medium">{value}</div>
    </div>
  )
}

function FieldLabel({ label: title, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 text-xs font-medium">
      {title}
      {children}
    </label>
  )
}

function OwnerSelect({
  value,
  operators,
  onChange,
}: {
  value: string
  operators: Operator[]
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium">
      Assigned staff
      <select
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Unassigned</option>
        {operators.map((operator) => (
          <option key={operator.id} value={operator.id}>
            {operator.email}
          </option>
        ))}
      </select>
    </label>
  )
}

function CompactOwnerSelect({
  value,
  operators,
  onChange,
}: {
  value: string
  operators: Operator[]
  onChange: (value: string) => void
}) {
  return (
    <select
      className="h-9 max-w-48 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Assigned staff"
    >
      <option value="">Unassigned</option>
      {operators.map((operator) => (
        <option key={operator.id} value={operator.id}>
          {operator.email}
        </option>
      ))}
    </select>
  )
}

function OwnerFilter({
  value,
  operators,
  onChange,
}: {
  value: string
  operators: Operator[]
  onChange: (value: string) => void
}) {
  return (
    <select
      className="h-10 rounded-md border bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Filter by assigned staff"
    >
      <option value="all">All staff</option>
      <option value="unassigned">Unassigned</option>
      {operators.map((operator) => (
        <option key={operator.id} value={operator.id}>
          {operator.email}
        </option>
      ))}
    </select>
  )
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input
        className="pl-9"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  )
}

function CopyRow({ label: title, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="text-xs font-medium">{title}</div>
      <div className="mt-1 flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{value}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1200)
            })
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  )
}

function Metric({
  label: title,
  value,
  detail,
  warning = false,
}: {
  label: string
  value: string | number | null
  detail: string
  warning?: boolean
}) {
  return (
    <Card className={warning ? "border-amber-500/40" : ""}>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="mt-2 text-3xl font-semibold">{value ?? "—"}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  )
}

function BillingActivity({ billing }: { billing: BillingOverview }) {
  const counts = billing.live.eventCounts30 || {}
  const events = billing.live.recentEvents || []
  const subscriptions = billing.subscriptionCounts || { active: 0, trialing: 0, pastDue: 0, canceled: 0 }
  const renewals = billing.upcomingRenewals || []
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="Recent payment activity" subtitle="Verified live Stripe events. Test events remain separate.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ReportValue label="Paid" value={counts.invoice_paid || 0} />
          <ReportValue label="Failed" value={counts.payment_failed || 0} />
          <ReportValue label="Refunds" value={counts.refund || 0} />
          <ReportValue label="Disputes" value={counts.dispute || 0} />
        </div>
        {events.slice(0, 10).map((event) => (
          <div key={event.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">{event.tenantName}</div>
              <div className="text-xs text-muted-foreground">
                {label(event.eventType)} · {new Date(event.occurredAt).toLocaleString()}
              </div>
            </div>
            <div className="text-sm font-medium">
              {Number(event.amountCents) > 0 ? currency(event.amountCents, event.currency) : "Status update"}
            </div>
          </div>
        ))}
        {!events.length ? (
          <EmptyState title="No recent payment activity" description="Verified live events will appear here." compact />
        ) : null}
      </Section>
      <Section title="Subscriptions and renewals" subtitle="Current synchronized subscription state.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ReportValue label="Active" value={subscriptions.active} />
          <ReportValue label="Trialing" value={subscriptions.trialing} />
          <ReportValue label="Past due" value={subscriptions.pastDue} />
          <ReportValue label="Canceled" value={subscriptions.canceled} />
        </div>
        {renewals.map((renewal) => (
          <div key={renewal.tenantId} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">{renewal.tenantName}</div>
              <div className="text-xs text-muted-foreground">
                Renews {new Date(renewal.renewsAt).toLocaleDateString()}
              </div>
            </div>
            <div className="text-sm font-medium">
              {renewal.amountCents != null && renewal.currency
                ? currency(renewal.amountCents, renewal.currency)
                : "Amount unavailable"}
            </div>
          </div>
        ))}
        {!renewals.length ? (
          <EmptyState title="No renewals due" description="No subscription renews in the next 30 days." compact />
        ) : null}
      </Section>
    </div>
  )
}

function ReportValue({ label: title, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-md bg-muted p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 text-lg font-semibold">{value ?? "—"}</div>
    </div>
  )
}

function HealthTile({
  label: title,
  status,
  healthy,
  detail,
}: {
  label: string
  status: string
  healthy: boolean
  detail: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium">{title}</div>
          <StatusBadge value={status} tone={healthy ? "success" : status === "Unavailable" ? "danger" : "warning"} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function ActivityRow({ title, detail, timestamp }: { title: string; detail?: string; timestamp: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {detail ? <div className="mt-1 text-sm text-muted-foreground">{detail}</div> : null}
      </div>
      <div className="shrink-0 text-xs text-muted-foreground">{new Date(timestamp).toLocaleString()}</div>
    </div>
  )
}

function onboardingGroupState(group: { label: string; keys: string[] }, readiness: TenantReadiness) {
  if (!group.keys.length) return "Complete"
  const items = readiness.required.filter((item) => group.keys.includes(item.key))
  if (!items.length || items.every((item) => item.passed)) return "Complete"
  if (group.label === "Launch approved" && items.some((item) => item.passed)) return "Ready for review"
  if (items.some((item) => item.passed)) return "In progress"
  return "Blocked"
}
