"use client"

import type React from "react"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  Inbox,
  Zap,
  BarChart3,
  Settings,
  Plug,
  ChevronDown,
  CreditCard,
  Shield,
  Route,
  ClipboardCheck,
  LifeBuoy,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useEffect, useState } from "react"
import { Logo } from "@/components/logo"
import { fetchMePlan, type PlanName } from "@/lib/plan"
import { canUseTeams, canUseBrokerage } from "@/lib/access"

const mainNavItems = [
  { label: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
  { label: "Setup & readiness", href: "/app/onboarding", icon: ClipboardCheck },
  { label: "Leads", href: "/app/leads", icon: Users },
  { label: "Inbox", href: "/app/inbox", icon: Inbox },
]

const automationItems = [
  { label: "Automations", href: "/app/automations", icon: Zap },
]

const analyticsItems = [
  { label: "Reporting", href: "/app/reports", icon: BarChart3 },
  { label: "Integrations", href: "/app/integrations", icon: Plug },
]

const settingsItems = [
  { label: "Team", href: "/app/team", icon: Users, gate: "teams" as const },
  { label: "Routing", href: "/app/routing", icon: Route, gate: "teams" as const },
  { label: "Compliance", href: "/app/compliance", icon: Shield, gate: "enterprise" as const },
  { label: "Settings", href: "/app/settings", icon: Settings },
  { label: "Billing", href: "/app/billing", icon: CreditCard },
  { label: "Support", href: "/support", icon: LifeBuoy },
]

interface SidebarProps {
  isCollapsed?: boolean
  onClose?: () => void
}

export function Sidebar({ isCollapsed = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const [automationOpen, setAutomationOpen] = useState(true)
  const [analyticsOpen, setAnalyticsOpen] = useState(true)
  const [plan, setPlan] = useState<PlanName>("free")
  const [hasTeams, setHasTeams] = useState(false)
  const [hasEnterprise, setHasEnterprise] = useState(false)

  useEffect(() => {
    let mounted = true
    fetchMePlan()
      .then((d) => {
        if (!mounted) return
        const p = ((d?.plan as any) || "free") as PlanName
        setPlan(p)
        setHasTeams(canUseTeams(p))
        setHasEnterprise(canUseBrokerage(p))
      })
      .catch(() => {
        if (!mounted) return
        setPlan("free")
        setHasTeams(false)
        setHasEnterprise(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  const NavItem = ({
    item,
    collapsed,
    locked,
    badge,
  }: {
    item: { label: string; href: string; icon: React.ElementType }
    collapsed: boolean
    locked?: boolean
    badge?: string
  }) => {
    const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
    const Icon = item.icon

    return (
      <Link
        href={item.href}
        onClick={onClose}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-sidebar-accent text-sidebar-primary"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          locked && "opacity-70",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <div className="flex w-full items-center justify-between">
            <span>{item.label}</span>
            {locked && badge ? <span className="text-[11px] rounded bg-muted px-2 py-0.5">{badge}</span> : null}
          </div>
        )}
      </Link>
    )
  }

  const isLocked = (gate?: "teams" | "enterprise") => {
    if (!gate) return { locked: false, badge: "" }
    if (gate === "teams") return { locked: !hasTeams, badge: "Teams" }
    return { locked: !hasEnterprise, badge: "Enterprise" }
  }

  const analyticsAndSettingsItems = [...analyticsItems, ...settingsItems]

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        <Logo href="/app/dashboard" size="md" showText={!isCollapsed} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        <div className="space-y-1">
          {mainNavItems.map((item) => (
            <NavItem key={item.href} item={item} collapsed={isCollapsed} />
          ))}
        </div>

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

        {!isCollapsed && (
          <Collapsible open={analyticsOpen} onOpenChange={setAnalyticsOpen} className="mt-6">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-sidebar-foreground">
              Analytics & Settings
              <ChevronDown className={cn("h-3 w-3 transition-transform", analyticsOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 pt-1">
              {analyticsAndSettingsItems.map((item: any) => {
                const { locked, badge } = isLocked(item.gate)
                return (
                  <NavItem
                    key={item.href}
                    item={item}
                    collapsed={isCollapsed}
                    locked={locked}
                    badge={badge}
                  />
                )
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        {isCollapsed && (
          <div className="mt-6 space-y-1">
            {[...automationItems, ...analyticsAndSettingsItems].map((item: any) => {
              const { locked, badge } = isLocked(item.gate)
              return (
                <NavItem
                  key={item.href}
                  item={item}
                  collapsed={isCollapsed}
                  locked={locked}
                  badge={badge}
                />
              )
            })}
          </div>
        )}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className={cn("rounded-lg bg-sidebar-accent/50 p-3", isCollapsed && "p-2")}>
          {!isCollapsed ? (
            <>
              <p className="text-xs font-medium text-sidebar-foreground">{String(plan).toUpperCase()} Plan</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasTeams ? "Team features unlocked" : "Single-user workspace"}
              </p>
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
