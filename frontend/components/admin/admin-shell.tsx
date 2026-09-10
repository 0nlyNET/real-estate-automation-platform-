"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  Activity,
  Building2,
  ClipboardCheck,
  CreditCard,
  FileClock,
  HeartPulse,
  LifeBuoy,
  ListTodo,
  Menu,
  Settings,
  Users,
  Bot,
} from "lucide-react"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useAdminSession } from "@/app/admin/admin-access-guard"
import {
  adminViewHref,
  normalizeAdminView,
  primaryAdminNavigation,
  secondaryAdminNavigation,
  type AdminNavigationItem,
  type AdminView,
} from "./admin-navigation"

const icons: Record<AdminView, typeof Activity> = {
  overview: Activity,
  clients: Building2,
  leads: Users,
  onboarding: ClipboardCheck,
  tasks: ListTodo,
  support: LifeBuoy,
  billing: CreditCard,
  health: HeartPulse,
  audit: FileClock,
  settings: Settings,
}

/**
 * Renders a single navigation link with icon and active state styling,
 * optionally wrapped in SheetClose for mobile drawer integration.
 *
 * @param item - The navigation item to render
 * @param active - Whether this link is the currently active page
 * @param mobile - Whether to wrap in SheetClose for mobile drawer
 * @returns React component with styled link
 */
function NavigationLink({
  item,
  active,
  mobile = false,
}: {
  item: AdminNavigationItem
  active: boolean
  mobile?: boolean
}) {
  const Icon = icons[item.id]
  const link = (
    <Link
      prefetch={false}
      href={adminViewHref(item.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  )
  return mobile ? <SheetClose asChild>{link}</SheetClose> : link
}

/**
 * Renders the admin navigation menu with primary links and optional super admin
 * section, supporting both desktop sidebar and mobile drawer modes.
 *
 * @param activeView - The currently active admin view/page
 * @param isOwner - Whether the user has super_admin role
 * @param mobile - Whether to render for mobile drawer with SheetClose wrappers
 * @returns React component with navigation links
 */
function Navigation({
  activeView,
  isOwner,
  mobile = false,
}: {
  activeView: AdminView
  isOwner: boolean
  mobile?: boolean
}) {
  return (
    <nav aria-label="Admin navigation" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-1 px-3 py-4">
        {primaryAdminNavigation.map((item) => (
          <NavigationLink key={item.id} item={item} active={activeView === item.id} mobile={mobile} />
        ))}
        {mobile ? (
          <SheetClose asChild>
            <Link prefetch={false} href="/admin/assistant" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Bot className="h-4 w-4" />Operations AI</Link>
          </SheetClose>
        ) : (
          <Link prefetch={false} href="/admin/assistant" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Bot className="h-4 w-4" />Operations AI</Link>
        )}
      </div>
      {isOwner ? (
        <div className="mt-auto border-t px-3 py-4">
          <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Super administrator
          </div>
          <div className="space-y-1">
            {secondaryAdminNavigation.map((item) => (
              <NavigationLink key={item.id} item={item} active={activeView === item.id} mobile={mobile} />
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  )
}

/**
 * Main admin shell component that wraps admin dashboard pages with sidebar
 * navigation, mobile sheet, and user info display. Restricts certain views
 * based on super_admin vs staff role.
 *
 * @param children - The admin page content to render
 * @returns React component with admin layout
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const session = useAdminSession()
  const searchParams = useSearchParams()
  const isOwner = session.platformRole === "super_admin"
  const requestedView = normalizeAdminView(searchParams.get("view"))
  const activeView =
    !isOwner && secondaryAdminNavigation.some((item) => item.id === requestedView) ? "overview" : requestedView

  return (
    <div className="min-h-screen bg-muted/20 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-background lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Logo href="/admin/dashboard" size="sm" />
        </div>
        <Navigation activeView={activeView} isOwner={isOwner} />
        <div className="border-t px-5 py-4">
          <div className="truncate text-sm font-medium">{session.email}</div>
          <div className="text-xs text-muted-foreground">{isOwner ? "Super administrator" : "Staff"}</div>
          <Link prefetch={false} className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground" href="/logout">
            Log out
          </Link>
        </div>
      </aside>

      <div className="min-w-0 lg:col-start-2">
        <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open admin navigation">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetHeader className="border-b text-left">
                <SheetTitle>RealtyTechAI</SheetTitle>
                <SheetDescription>Admin workspace</SheetDescription>
              </SheetHeader>
              <Navigation activeView={activeView} isOwner={isOwner} mobile />
              <div className="border-t px-5 py-4">
                <div className="truncate text-sm font-medium">{session.email}</div>
                <Link prefetch={false} className="mt-1 inline-block text-sm text-muted-foreground hover:text-foreground" href="/logout">
                  Log out
                </Link>
              </div>
            </SheetContent>
          </Sheet>
          <Logo href="/admin/dashboard" size="sm" />
          <div className="w-9" aria-hidden="true" />
        </div>

        <main id="admin-main" className="mx-auto w-full max-w-[90rem] px-4 py-5 md:px-6 md:py-7">
          {children}
        </main>
      </div>
    </div>
  )
}
