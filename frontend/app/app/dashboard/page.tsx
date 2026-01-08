"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  Users,
  MessageSquare,
  Clock,
  TrendingUp,
  ArrowRight,
  Send,
  Calendar,
  Zap,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"

const stats = [
  { label: "New Leads Today", value: "12", change: "+3", icon: Users, trend: "up" },
  { label: "Unread Messages", value: "8", change: "+5", icon: MessageSquare, trend: "up" },
  { label: "Avg Response Time", value: "32s", change: "-8s", icon: Clock, trend: "up" },
  { label: "Conversion Rate", value: "18.5%", change: "+2.1%", icon: TrendingUp, trend: "up" },
]

const nextBestActions = [
  {
    id: 1,
    type: "urgent",
    title: "3 leads waiting for response",
    description: "Leads from Facebook Ads haven't been contacted yet",
    action: "Respond now",
    href: "/app/inbox",
  },
  {
    id: 2,
    type: "reminder",
    title: "Follow up with Sarah Johnson",
    description: "Scheduled for today at 2:00 PM",
    action: "View lead",
    href: "/app/leads",
  },
  {
    id: 3,
    type: "suggestion",
    title: "Enable auto-reply for weekends",
    description: "You missed 4 leads last weekend",
    action: "Setup now",
    href: "/app/automations",
  },
]

const recentActivity = [
  { id: 1, type: "lead", message: "New lead: Mike Chen from Facebook Ads", time: "5 min ago" },
  { id: 2, type: "message", message: "John Smith replied to your message", time: "12 min ago" },
  { id: 3, type: "booking", message: "Appointment booked with Lisa Park", time: "1 hour ago" },
  { id: 4, type: "automation", message: "Follow-up sequence completed for 3 leads", time: "2 hours ago" },
  { id: 5, type: "lead", message: "New lead: Emily Davis from website form", time: "3 hours ago" },
]

const quickActions = [
  { label: "Send Message", icon: Send, href: "/app/inbox" },
  { label: "Add Lead", icon: Users, href: "/app/leads" },
  { label: "Schedule Call", icon: Calendar, href: "/app/leads" },
  { label: "Create Automation", icon: Zap, href: "/app/automations" },
]

export default function DashboardPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const handleQuickAction = (action: (typeof quickActions)[0]) => {
    toast({
      title: action.label,
      description: `Navigating to ${action.label.toLowerCase()}...`,
    })
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">Welcome back! Here's what's happening with your leads.</p>
          </div>
          <div className="flex gap-2">
            {quickActions.slice(0, 2).map((action) => (
              <Button
                key={action.label}
                variant="outline"
                size="sm"
                asChild
                className="bg-transparent transition-all hover:bg-secondary hover:scale-[1.02] active:scale-[0.98]"
              >
                <Link href={action.href}>
                  <action.icon className="mr-2 h-4 w-4" />
                  {action.label}
                </Link>
              </Button>
            ))}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="border-border bg-card">
                  <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="mt-2 h-3 w-20" />
                  </CardContent>
                </Card>
              ))
            : stats.map((stat, index) => (
                <Card
                  key={index}
                  className="border-border bg-card transition-all duration-200 hover:border-primary/50 hover:shadow-lg"
                >
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                    <stat.icon className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-card-foreground">{stat.value}</div>
                    <p className="text-xs text-muted-foreground">
                      <span className="text-primary">{stat.change}</span> from yesterday
                    </p>
                  </CardContent>
                </Card>
              ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Next Best Actions */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-card-foreground">
                <AlertCircle className="h-5 w-5 text-primary" />
                Next Best Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-4 rounded-lg border border-border p-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-64" />
                      </div>
                    </div>
                  ))
                : nextBestActions.map((action) => (
                    <div
                      key={action.id}
                      className="flex items-start gap-4 rounded-lg border border-border bg-secondary/30 p-4 transition-all hover:border-primary/50 hover:bg-secondary/50"
                    >
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full ${
                          action.type === "urgent"
                            ? "bg-destructive/10 text-destructive"
                            : action.type === "reminder"
                              ? "bg-yellow-500/10 text-yellow-500"
                              : "bg-primary/10 text-primary"
                        }`}
                      >
                        {action.type === "urgent" ? (
                          <AlertCircle className="h-5 w-5" />
                        ) : action.type === "reminder" ? (
                          <Clock className="h-5 w-5" />
                        ) : (
                          <Zap className="h-5 w-5" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-foreground">{action.title}</h4>
                        <p className="text-xs text-muted-foreground">{action.description}</p>
                      </div>
                      <Button size="sm" variant="outline" asChild className="bg-transparent shrink-0">
                        <Link href={action.href}>
                          {action.action}
                          <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  ))}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-card-foreground">
                Recent Activity
                <Button variant="ghost" size="sm" className="text-primary">
                  View all
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-4">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="flex-1 space-y-1">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                    ))
                  : recentActivity.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-center gap-4 rounded-lg p-2 transition-colors hover:bg-secondary/50"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          {activity.type === "lead" ? (
                            <Users className="h-4 w-4 text-primary" />
                          ) : activity.type === "message" ? (
                            <MessageSquare className="h-4 w-4 text-primary" />
                          ) : activity.type === "booking" ? (
                            <Calendar className="h-4 w-4 text-primary" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm text-foreground">{activity.message}</p>
                          <p className="text-xs text-muted-foreground">{activity.time}</p>
                        </div>
                      </div>
                    ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-card-foreground">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  className="h-24 flex-col gap-2 bg-transparent transition-all hover:border-primary/50 hover:bg-secondary hover:scale-[1.02] active:scale-[0.98]"
                  asChild
                >
                  <Link href={action.href}>
                    <action.icon className="h-6 w-6 text-primary" />
                    <span>{action.label}</span>
                  </Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
