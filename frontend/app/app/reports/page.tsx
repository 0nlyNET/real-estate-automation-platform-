"use client"

import { useState, useEffect } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LockedFeatureModal } from "@/components/ui/locked-feature-modal"
import {
  Download,
  TrendingUp,
  TrendingDown,
  Users,
  Mail,
  MessageSquare,
  DollarSign,
  Calendar,
  ArrowUpRight,
  Lock,
} from "lucide-react"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"

const leadSourceData = [
  { name: "Facebook Ads", value: 35, color: "#3b82f6" },
  { name: "Website", value: 28, color: "#10b981" },
  { name: "Referrals", value: 20, color: "#8b5cf6" },
  { name: "Zapier", value: 12, color: "#f59e0b" },
  { name: "Other", value: 5, color: "#6b7280" },
]

const conversionData = [
  { name: "Jan", leads: 45, conversions: 8 },
  { name: "Feb", leads: 52, conversions: 11 },
  { name: "Mar", leads: 61, conversions: 14 },
  { name: "Apr", leads: 58, conversions: 12 },
  { name: "May", leads: 72, conversions: 18 },
  { name: "Jun", leads: 85, conversions: 22 },
]

const responseTimeData = [
  { name: "Mon", avgTime: 12 },
  { name: "Tue", avgTime: 8 },
  { name: "Wed", avgTime: 15 },
  { name: "Thu", avgTime: 6 },
  { name: "Fri", avgTime: 10 },
  { name: "Sat", avgTime: 25 },
  { name: "Sun", avgTime: 30 },
]

const automationPerformance = [
  { name: "New Lead Auto-Reply", sent: 234, opened: 189, clicked: 67 },
  { name: "Lead Qualification", sent: 156, opened: 112, clicked: 45 },
  { name: "Appointment Reminder", sent: 512, opened: 489, clicked: 156 },
  { name: "Missed Call Follow-up", sent: 89, opened: 72, clicked: 28 },
]

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState("30d")
  const [lockedModalOpen, setLockedModalOpen] = useState(false)
  const userPlan = "starter" // Mock

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const handleExport = () => {
    if (userPlan === "starter") {
      setLockedModalOpen(true)
    } else {
      // Export logic
    }
  }

  const stats = [
    {
      label: "Total Leads",
      value: "373",
      change: "+12.5%",
      trend: "up",
      icon: Users,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      label: "Conversion Rate",
      value: "24.3%",
      change: "+3.2%",
      trend: "up",
      icon: TrendingUp,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      label: "Avg Response Time",
      value: "14 min",
      change: "-25%",
      trend: "up",
      icon: Calendar,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "Revenue (Est.)",
      value: "$127,500",
      change: "+18.7%",
      trend: "up",
      icon: DollarSign,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
    },
  ]

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reports</h1>
            <p className="text-muted-foreground">Analytics and insights for your business.</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-36 bg-secondary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="1y">Last year</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleExport} variant="outline" className="bg-transparent">
              {userPlan === "starter" && <Lock className="h-4 w-4 mr-2" />}
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="border-border bg-card">
              <CardContent className="p-4">
                {loading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{stat.label}</p>
                      <p className="text-2xl font-semibold text-foreground mt-1">{stat.value}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {stat.trend === "up" ? (
                          <ArrowUpRight className="h-4 w-4 text-green-500" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-500" />
                        )}
                        <span className={stat.trend === "up" ? "text-green-500 text-sm" : "text-red-500 text-sm"}>
                          {stat.change}
                        </span>
                      </div>
                    </div>
                    <div className={`h-10 w-10 rounded-lg ${stat.bgColor} flex items-center justify-center`}>
                      <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="leads">Leads</TabsTrigger>
            <TabsTrigger value="automations">Automations</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Conversion Trend */}
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-base font-medium">Leads & Conversions</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-64 w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={conversionData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="leads"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                        />
                        <Line type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Lead Sources Pie */}
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-base font-medium">Lead Sources</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-64 w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={leadSourceData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}%`}
                          labelLine={false}
                        >
                          {leadSourceData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Response Time */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base font-medium">Average Response Time (minutes)</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={responseTimeData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar dataKey="avgTime" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leads" className="space-y-4">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base font-medium">Lead Pipeline</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                    {[
                      { stage: "New", count: 45, color: "bg-blue-500" },
                      { stage: "Contacted", count: 32, color: "bg-yellow-500" },
                      { stage: "Qualified", count: 28, color: "bg-primary" },
                      { stage: "Proposal", count: 15, color: "bg-purple-500" },
                      { stage: "Won", count: 12, color: "bg-green-500" },
                      { stage: "Lost", count: 8, color: "bg-red-500" },
                    ].map((item) => (
                      <div key={item.stage} className="text-center p-4 rounded-lg bg-secondary/50">
                        <div className={`h-2 w-full ${item.color} rounded-full mb-3`} />
                        <p className="text-2xl font-semibold text-foreground">{item.count}</p>
                        <p className="text-sm text-muted-foreground">{item.stage}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="automations" className="space-y-4">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base font-medium">Automation Performance</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {automationPerformance.map((auto) => (
                      <div key={auto.name} className="p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center justify-between mb-3">
                          <p className="font-medium text-foreground">{auto.name}</p>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                              <span className="text-foreground">{auto.sent}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <MessageSquare className="h-4 w-4 text-muted-foreground" />
                              <span className="text-foreground">{auto.opened}</span>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Open Rate</span>
                            <span className="text-foreground">{Math.round((auto.opened / auto.sent) * 100)}%</span>
                          </div>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${(auto.opened / auto.sent) * 100}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Click Rate</span>
                            <span className="text-foreground">{Math.round((auto.clicked / auto.sent) * 100)}%</span>
                          </div>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full"
                              style={{ width: `${(auto.clicked / auto.sent) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <LockedFeatureModal
        open={lockedModalOpen}
        onOpenChange={setLockedModalOpen}
        feature="Export Reports"
        requiredPlan="Professional"
      />
    </AppShell>
  )
}
