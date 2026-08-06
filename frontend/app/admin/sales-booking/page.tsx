import { redirect } from "next/navigation"

export default function LegacyAdminSalesBookingPage() {
  redirect("/admin/dashboard?view=settings")
}
