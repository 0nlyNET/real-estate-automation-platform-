"use client"

import type React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  CalendarDays,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Bot,
  Plug,
  Users,
} from "lucide-react"
import { Logo } from "@/components/logo"
import { cn } from "@/lib/utils"
import { clientNavigation } from "@/lib/client-navigation"

const icons = [LayoutDashboard, Users, Inbox, CalendarDays, Plug, Bot]
const navItems = [
  ...clientNavigation.map((item, index) => ({ ...item, icon: icons[index] })),
  { label: "Help", href: "/support", icon: LifeBuoy },
]

interface SidebarProps {
  isCollapsed?: boolean
  onClose?: () => void
}

/**
 * Sidebar navigation component for client workspace with links to all main
 * sections. Supports collapsed mode and mobile sheet integration.
 *
 * @param isCollapsed - Whether to show icon-only navigation
 * @param onClose - Optional callback when a navigation item is clicked (for mobile)
 * @returns React component with navigation links and branding
 */
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
      prefetch={false}
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
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
          RealtyTechAI handles the follow-up. You step in when a person needs you.
        </div>
      ) : null}
    </div>
  )
}
