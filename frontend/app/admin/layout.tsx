import type { ReactNode } from "react"
import Link from "next/link"
import { NotificationCenter } from "@/components/admin/notification-center"
import { Logo } from "@/components/logo"
import { AdminAccessGuard } from "./admin-access-guard"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAccessGuard>
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Logo href="/admin/overview" size="sm" />
            <div className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">Operations</div>
          </div>

          <nav className="flex items-center gap-2 text-sm md:gap-4">
            <Link className="text-muted-foreground hover:text-foreground" href="/admin/overview">
              Overview
            </Link>
            <Link className="hidden text-muted-foreground hover:text-foreground sm:inline" href="/admin/dashboard">
              Full operations
            </Link>
            <NotificationCenter />
            <Link className="text-muted-foreground hover:text-foreground" href="/logout">
              Logout
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-8">{children}</main>
    </div>
    </AdminAccessGuard>
  )
}
