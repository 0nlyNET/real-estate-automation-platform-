import { redirect } from "next/navigation"

export default function LegacyAdminIntegrationsPage() {
  redirect("/admin/dashboard?view=settings")
}
