import { AdminDashboardClient } from "./admin-dashboard-client"
import { ConsentAcknowledgmentCard } from "@/components/admin/consent-acknowledgment-card"
import { normalizeAdminView } from "@/components/admin/admin-navigation"

const clientTabs = new Set(["overview", "leads", "conversations", "appointments", "setup", "billing", "activity"])

type AdminDashboardPageProps = {
  searchParams: Promise<{
    view?: string | string[]
    tenantId?: string | string[]
    clientTab?: string | string[]
  }>
}

export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const params = await searchParams
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view
  const requestedTenantId = Array.isArray(params.tenantId) ? params.tenantId[0] : params.tenantId
  const requestedClientTab = Array.isArray(params.clientTab) ? params.clientTab[0] : params.clientTab
  const initialClientTab = clientTabs.has(requestedClientTab || "") ? requestedClientTab! : "overview"
  const initialView = normalizeAdminView(requestedView)
  const showConsentAcknowledgment =
    initialView === "clients" && Boolean(requestedTenantId) && initialClientTab === "setup"

  return (
    <div className="space-y-6">
      {showConsentAcknowledgment && requestedTenantId ? (
        <ConsentAcknowledgmentCard tenantId={requestedTenantId} />
      ) : null}
      <AdminDashboardClient
        initialView={initialView}
        initialTenantId={requestedTenantId}
        initialClientTab={
          initialClientTab as "overview" | "leads" | "conversations" | "appointments" | "setup" | "billing" | "activity"
        }
      />
    </div>
  )
}
