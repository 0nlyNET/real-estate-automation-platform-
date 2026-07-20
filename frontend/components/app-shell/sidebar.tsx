"use client"

import type React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  ClipboardCheck,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Plug,
  Route,
  Settings,
  Shield,
  Users,
  Zap,
} from "lucide-react"
import { Logo } from "@/components/logo"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Home", href: "/app/dashboard", icon: LayoutDashboard },
  { label: "Get started", href: "/app/onboarding", icon: ClipboardCheck },
  { label: "Leads", href: "/app/leads", icon: Users },
  { label: "Messages", href: "/app/inbox", icon: Inbox },
  { label: "Follow-up", href: "/app/automations", icon: Zap },
  { label: "Reports", href: "/app/reports", icon: BarChart3 },
  { label: "Connections", href: "/app/integrations", icon: Plug },
  { label: "Team", href: "/app/team", icon: Users },
  { label: "Lead routing", href: "/app/routing", icon: Route },
  { label: "Compliance", href: "/app/compliance", icon: Shield },
  { label: "Settings", href: "/app/settings", icon: Settings },
  { label: "Billing", href: "/app/billing", icon: CreditCard },
  { label: "Help", href: "/support", icon: LifeBuoy },
]

interface SidebarProps {
  isCollapsed?: boolean
  onClose?: () => void
}

export function Sidebar({ isCollapsed = false, onClose }: SidebarProps) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        <Logo href="/app/dashboard" size="md" showText={!isCollapsed} />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon as React.ElementType
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!isCollapsed ? <span>{item.label}</span> : null}
            </Link>
          )
        })}
      </nav>
      {!isCollapsed ? (
        <div className="border-t border-sidebar-border p-4 text-xs text-muted-foreground">
          One managed RealtyTechAI service. Your team handles strategy; the workspace keeps setup and delivery clear.
        </div>
      ) : null}
    </div>
  )
}
