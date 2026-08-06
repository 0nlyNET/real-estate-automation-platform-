import { Suspense, type ReactNode } from "react"
import { AdminShell } from "@/components/admin/admin-shell"
import { AdminAccessGuard } from "./admin-access-guard"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAccessGuard>
      <Suspense fallback={<div className="min-h-screen bg-background" aria-label="Loading admin navigation" />}>
        <AdminShell>{children}</AdminShell>
      </Suspense>
    </AdminAccessGuard>
  )
}
