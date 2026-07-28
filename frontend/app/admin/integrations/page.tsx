import ManagedIntegrations from "@/components/admin/managed-integrations"
import SalesBookingSettings from "@/components/admin/sales-booking-settings"

export default function AdminIntegrationsPage() {
  return (
    <div className="space-y-8">
      <SalesBookingSettings />
      <ManagedIntegrations />
    </div>
  )
}
