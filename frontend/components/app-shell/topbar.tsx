"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Search,
  Bell,
  Menu,
  X,
  ChevronDown,
  LogOut,
  User,
  Settings,
  Building2,
  Sparkles,
  CreditCard,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"

interface TopbarProps {
  onMenuClick: () => void
  isSidebarOpen: boolean
}

const workspaces = [
  { id: "1", name: "My Agency", role: "Owner" },
  { id: "2", name: "Partner Team", role: "Admin" },
  { id: "3", name: "Luxury Division", role: "Member" },
]

const notifications = [
  {
    id: 1,
    title: "New lead assigned",
    description: "Sarah Johnson interested in 456 Oak Ave",
    time: "2 min ago",
    unread: true,
  },
  {
    id: 2,
    title: "Automation completed",
    description: "Follow-up sequence finished for 8 contacts",
    time: "1 hour ago",
    unread: true,
  },
  {
    id: 3,
    title: "Appointment booked",
    description: "Mike Chen scheduled for tomorrow at 2pm",
    time: "3 hours ago",
    unread: true,
  },
  {
    id: 4,
    title: "Lead replied",
    description: "John Smith responded to your message",
    time: "5 hours ago",
    unread: false,
  },
]

export function Topbar({ onMenuClick, isSidebarOpen }: TopbarProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [searchFocused, setSearchFocused] = useState(false)
  const [currentWorkspace, setCurrentWorkspace] = useState(workspaces[0])

  const handleWorkspaceChange = (workspace: (typeof workspaces)[0]) => {
    setCurrentWorkspace(workspace)
    toast({
      title: "Workspace switched",
      description: `You are now viewing ${workspace.name}`,
    })
  }

  const handleUpgrade = () => {
    router.push("/app/billing")
  }

  const handleLogout = () => {
    toast({
      title: "Logged out",
      description: "You have been logged out successfully.",
    })
    router.push("/login")
  }

  const handleNotificationClick = (notification: (typeof notifications)[0]) => {
    toast({
      title: notification.title,
      description: notification.description,
    })
  }

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background px-4 lg:px-6">
      {/* Left Section */}
      <div className="flex items-center gap-4">
        {/* Mobile Menu Toggle */}
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
          {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          <span className="sr-only">Toggle menu</span>
        </Button>

        {/* Workspace Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2 hover:bg-secondary">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <span className="hidden text-sm font-medium md:inline-block">{currentWorkspace.name}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onClick={() => handleWorkspaceChange(workspace)}
                className={currentWorkspace.id === workspace.id ? "bg-secondary" : ""}
              >
                <div className="flex flex-1 items-center justify-between">
                  <span>{workspace.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {workspace.role}
                  </Badge>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => toast({ title: "Coming soon", description: "Workspace creation is coming soon." })}
            >
              + Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Plan Badge */}
        <Badge variant="outline" className="hidden border-primary/50 text-primary md:inline-flex">
          Pro Trial
        </Badge>

        {/* Search */}
        <div
          className={`relative hidden items-center transition-all duration-200 sm:flex ${
            searchFocused ? "w-80" : "w-64"
          }`}
        >
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search leads, messages..."
            className="h-9 w-full bg-secondary pl-9 text-sm placeholder:text-muted-foreground focus-visible:ring-primary"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          <kbd className="pointer-events-none absolute right-3 hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline-block">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2">
        {/* Upgrade Button */}
        <Button
          size="sm"
          onClick={handleUpgrade}
          className="hidden bg-primary text-primary-foreground hover:bg-primary/90 md:inline-flex"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Upgrade
        </Button>

        {/* Mobile Search */}
        <Button variant="ghost" size="icon" className="sm:hidden">
          <Search className="h-5 w-5" />
          <span className="sr-only">Search</span>
        </Button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <Badge className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary p-0 text-[10px] text-primary-foreground">
                {notifications.filter((n) => n.unread).length}
              </Badge>
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notifications
              <Badge variant="secondary" className="text-xs">
                {notifications.filter((n) => n.unread).length} new
              </Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="max-h-80 overflow-y-auto">
              {notifications.map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex w-full items-start justify-between">
                    <p className="text-sm font-medium">{notification.title}</p>
                    {notification.unread && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <p className="text-xs text-muted-foreground">{notification.description}</p>
                  <p className="text-xs text-muted-foreground">{notification.time}</p>
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="justify-center text-primary" onClick={() => router.push("/app/notifications")}>
              View all notifications
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2 hover:bg-secondary">
              <Avatar className="h-8 w-8">
                <AvatarImage src="/professional-headshot.png" />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">JD</AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start md:flex">
                <span className="text-sm font-medium">Jane Doe</span>
                <span className="text-xs text-muted-foreground">Admin</span>
              </div>
              <ChevronDown className="hidden h-4 w-4 text-muted-foreground md:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/app/settings">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/billing">
                <CreditCard className="mr-2 h-4 w-4" />
                Billing
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
