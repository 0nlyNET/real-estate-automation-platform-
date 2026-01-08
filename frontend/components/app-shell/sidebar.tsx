"use client"

import type React from "react"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  Building2,
  Users,
  Calendar,
  FileText,
  BarChart3,
  Settings,
  Zap,
  MessageSquare,
  FolderOpen,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useState } from "react"

const mainNavItems = [
  { label: "Dashboard", href: "/", icon: Home },
  { label: "Properties", href: "/properties", icon: Building2 },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Calendar", href: "/calendar", icon: Calendar },
  { label: "Documents", href: "/documents", icon: FileText },
]

const automationItems = [
  { label: "Workflows", href: "/workflows", icon: Zap },
  { label: "Messages", href: "/messages", icon: MessageSquare },
  { label: "Templates", href: "/templates", icon: FolderOpen },
]

const analyticsItems = [
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
]

interface SidebarProps {
  isCollapsed?: boolean
  onClose?: () => void
}

export function Sidebar({ isCollapsed = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const [automationOpen, setAutomationOpen] = useState(true)
  const [analyticsOpen, setAnalyticsOpen] = useState(true)

  const NavItem = ({
    item,
    collapsed,
  }: {
    item: { label: string; href: string; icon: React.ElementType }
    collapsed: boolean
  }) => {
    const isActive = pathname === item.href
    const Icon = item.icon

    return (
      <Link
        href={item.href}
        onClick={onClose}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    )
  }

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Building2 className="h-4 w-4 text-primary-foreground" />
        </div>
        {!isCollapsed && <span className="text-lg font-semibold text-sidebar-foreground">PropFlow</span>}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {/* Main Navigation */}
        <div className="space-y-1">
          {mainNavItems.map((item) => (
            <NavItem key={item.href} item={item} collapsed={isCollapsed} />
          ))}
        </div>

        {/* Automation Section */}
        {!isCollapsed && (
          <Collapsible open={automationOpen} onOpenChange={setAutomationOpen} className="mt-6">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-sidebar-foreground">
              Automation
              <ChevronDown className={cn("h-3 w-3 transition-transform", automationOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 pt-1">
              {automationItems.map((item) => (
                <NavItem key={item.href} item={item} collapsed={isCollapsed} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Analytics Section */}
        {!isCollapsed && (
          <Collapsible open={analyticsOpen} onOpenChange={setAnalyticsOpen} className="mt-6">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-sidebar-foreground">
              Analytics
              <ChevronDown className={cn("h-3 w-3 transition-transform", analyticsOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 pt-1">
              {analyticsItems.map((item) => (
                <NavItem key={item.href} item={item} collapsed={isCollapsed} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {isCollapsed && (
          <div className="mt-6 space-y-1">
            {[...automationItems, ...analyticsItems].map((item) => (
              <NavItem key={item.href} item={item} collapsed={isCollapsed} />
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        <div className={cn("rounded-lg bg-sidebar-accent/50 p-3", isCollapsed && "p-2")}>
          {!isCollapsed ? (
            <>
              <p className="text-xs font-medium text-sidebar-foreground">Pro Plan</p>
              <p className="mt-1 text-xs text-muted-foreground">15 days remaining</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sidebar-border">
                <div className="h-full w-1/2 rounded-full bg-primary" />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-primary" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
