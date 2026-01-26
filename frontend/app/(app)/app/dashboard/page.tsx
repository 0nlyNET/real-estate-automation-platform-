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
  { label: "New Leads Today", value: "0", change: "", icon: Users, trend: "flat" },
  { label: "Unread Messages", value: "0", change: "", icon: MessageSquare, trend: "flat" },
  { label: "Avg Response Time", value: "0s", change: "", icon: Clock, trend: "flat" },
  { label: "Conversion Rate", value: "0%", change: "", icon: TrendingUp, trend: "flat" },
]

const nextBestActions: any[] = []

const recentActivity: any[] = []

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
                    <p className="text-xs text-muted-foreground">No data yet</p>
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
                : nextBestActions.length ? (
                  nextBestActions.map((action) => (
                    <div key={action.id} />
                  ))
                ) : (
                  <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                    No actions yet. Connect an integration and add your first lead to see recommendations.
                  </div>
                )
              }
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
                  : recentActivity.length ? (
                  recentActivity.map((activity) => (
                    <div key={activity.id} />
                  ))
                ) : (
                  <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                    No activity yet.
                  </div>
                )
              }
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
