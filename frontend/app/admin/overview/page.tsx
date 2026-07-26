import { redirect } from "next/navigation"

export default function LegacyAdminOverviewPage() {
  redirect("/admin/dashboard")
}
