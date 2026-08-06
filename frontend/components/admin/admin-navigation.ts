export type AdminView =
  | "overview"
  | "clients"
  | "leads"
  | "onboarding"
  | "tasks"
  | "support"
  | "billing"
  | "health"
  | "audit"
  | "settings"

export type AdminNavigationItem = {
  id: AdminView
  label: string
  ownerOnly?: boolean
}

export const primaryAdminNavigation: AdminNavigationItem[] = [
  { id: "overview", label: "Overview" },
  { id: "clients", label: "Clients" },
  { id: "leads", label: "Leads" },
  { id: "onboarding", label: "Onboarding" },
  { id: "tasks", label: "Tasks" },
  { id: "support", label: "Support" },
]

export const secondaryAdminNavigation: AdminNavigationItem[] = [
  { id: "billing", label: "Billing", ownerOnly: true },
  { id: "health", label: "System health", ownerOnly: true },
  { id: "audit", label: "Audit log", ownerOnly: true },
  { id: "settings", label: "Settings", ownerOnly: true },
]

const legacyViewAliases: Record<string, AdminView> = {
  activity: "audit",
  ai: "settings",
  appointments: "leads",
  handoffs: "leads",
  integrations: "settings",
  reporting: "billing",
}

export function normalizeAdminView(value?: string | null): AdminView {
  if (!value) return "overview"
  const alias = legacyViewAliases[value]
  if (alias) return alias
  const item = [...primaryAdminNavigation, ...secondaryAdminNavigation].find((candidate) => candidate.id === value)
  return item?.id || "overview"
}

export function adminViewHref(view: AdminView, tenantId?: string) {
  const query = new URLSearchParams({ view })
  if (tenantId) query.set("tenantId", tenantId)
  return `/admin/dashboard?${query.toString()}`
}
