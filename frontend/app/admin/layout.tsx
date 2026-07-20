import type { ReactNode } from "react"
import Link from "next/link"

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-foreground">RealtyTechAI</div>
            <div className="text-xs text-muted-foreground">Admin operating center</div>
          </div>

          <nav className="flex flex-wrap items-center gap-4 text-sm">
            <Link className="text-muted-foreground hover:text-foreground" href="/admin/overview">
              Overview
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/admin/dashboard">
              Operations
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/app/dashboard">
              View as client
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/logout">
              Logout
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  )
}
