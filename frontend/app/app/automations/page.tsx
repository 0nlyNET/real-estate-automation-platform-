"use client"

import { useState, useEffect } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { LockedFeatureModal } from "@/components/ui/locked-feature-modal"
import {
  Search,
  Plus,
  Zap,
  Mail,
  MessageSquare,
  Calendar,
  Clock,
  MoreHorizontal,
  Play,
  Pause,
  Copy,
  Trash2,
  ArrowRight,
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const mockAutomations = [
  {
    id: "1",
    name: "New Lead Auto-Reply",
    description: "Send instant email response when a new lead comes in",
    trigger: "New Lead Created",
    triggerIcon: Zap,
    actions: [
      { type: "email", label: "Send Welcome Email" },
      { type: "delay", label: "Wait 24 hours" },
      { type: "sms", label: "Send Follow-up SMS" },
    ],
    active: true,
    runs: 234,
    lastRun: "2 min ago",
  },
  {
    id: "2",
    name: "Lead Qualification Sequence",
    description: "Multi-step nurture sequence for new website leads",
    trigger: "Lead Source = Website",
    triggerIcon: Zap,
    actions: [
      { type: "email", label: "Send Property Guide" },
      { type: "delay", label: "Wait 3 days" },
      { type: "email", label: "Send Market Report" },
      { type: "delay", label: "Wait 7 days" },
      { type: "task", label: "Create Follow-up Task" },
    ],
    active: true,
    runs: 156,
    lastRun: "1 hour ago",
  },
  {
    id: "3",
    name: "Missed Call Follow-up",
    description: "Automatically text when a call is missed",
    trigger: "Missed Call",
    triggerIcon: Calendar,
    actions: [
      { type: "sms", label: "Send Apology SMS" },
      { type: "task", label: "Create Callback Task" },
    ],
    active: false,
    runs: 89,
    lastRun: "3 days ago",
  },
  {
    id: "4",
    name: "Appointment Reminder",
    description: "Send reminders before scheduled showings",
    trigger: "24h Before Appointment",
    triggerIcon: Clock,
    actions: [
      { type: "email", label: "Send Reminder Email" },
      { type: "sms", label: "Send Reminder SMS" },
    ],
    active: true,
    runs: 512,
    lastRun: "30 min ago",
  },
]

const templates = [
  { id: "1", name: "Lead Nurture", description: "7-day email sequence", icon: Mail },
  { id: "2", name: "Re-engagement", description: "Win back cold leads", icon: MessageSquare },
  { id: "3", name: "Showing Follow-up", description: "Post-viewing automation", icon: Calendar },
  { id: "4", name: "Birthday Wishes", description: "Annual client outreach", icon: Zap },
]

export default function AutomationsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [automations, setAutomations] = useState(mockAutomations)
  const [searchQuery, setSearchQuery] = useState("")
  const [lockedModalOpen, setLockedModalOpen] = useState(false)
  const userPlan = "starter" // Mock - would come from context

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const filteredAutomations = automations.filter(
    (auto) =>
      auto.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      auto.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleToggle = (id: string) => {
    setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, active: !a.active } : a)))
    const auto = automations.find((a) => a.id === id)
    toast({
      title: auto?.active ? "Automation paused" : "Automation activated",
      description: `"${auto?.name}" has been ${auto?.active ? "paused" : "activated"}.`,
    })
  }

  const handleDuplicate = (id: string) => {
    const auto = automations.find((a) => a.id === id)
    if (auto) {
      const newAuto = {
        ...auto,
        id: Date.now().toString(),
        name: `${auto.name} (Copy)`,
        runs: 0,
        lastRun: "Never",
        active: false,
      }
      setAutomations((prev) => [...prev, newAuto])
      toast({ title: "Automation duplicated", description: `"${newAuto.name}" created.` })
    }
  }

  const handleDelete = (id: string) => {
    setAutomations((prev) => prev.filter((a) => a.id !== id))
    toast({ title: "Automation deleted", description: "The automation has been removed." })
  }

  const handleCreateNew = () => {
    if (userPlan === "starter" && automations.length >= 3) {
      setLockedModalOpen(true)
    } else {
      toast({ title: "Create Automation", description: "Opening workflow builder..." })
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Automations</h1>
            <p className="text-muted-foreground">Create and manage your automated workflows.</p>
          </div>
          <Button
            onClick={handleCreateNew}
            className="bg-primary text-primary-foreground hover:bg-primary/90 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Automation
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Automations</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {loading ? <Skeleton className="h-8 w-12" /> : automations.filter((a) => a.active).length}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Runs (30d)</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {loading ? (
                      <Skeleton className="h-8 w-16" />
                    ) : (
                      automations.reduce((sum, a) => sum + a.runs, 0).toLocaleString()
                    )}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Play className="h-5 w-5 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Emails Sent</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {loading ? <Skeleton className="h-8 w-16" /> : "1,847"}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Mail className="h-5 w-5 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Templates */}
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search automations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-secondary pl-9"
              />
            </div>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="bg-transparent">
                Browse Templates
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Automation Templates</DialogTitle>
                <DialogDescription>Start with a pre-built template and customize it.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-4">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    className="flex items-center gap-4 p-4 rounded-lg border border-border bg-secondary/50 hover:bg-secondary transition-colors text-left"
                  >
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <template.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{template.name}</p>
                      <p className="text-sm text-muted-foreground">{template.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Automations List */}
        <div className="space-y-4">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="border-border bg-card">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-3 flex-1">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-64" />
                        <div className="flex gap-2">
                          <Skeleton className="h-8 w-24" />
                          <Skeleton className="h-8 w-24" />
                          <Skeleton className="h-8 w-24" />
                        </div>
                      </div>
                      <Skeleton className="h-6 w-12" />
                    </div>
                  </CardContent>
                </Card>
              ))
            : filteredAutomations.map((auto) => (
                <Card key={auto.id} className="border-border bg-card">
                  <CardContent className="p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold text-foreground">{auto.name}</h3>
                          <Badge
                            variant="outline"
                            className={
                              auto.active ? "bg-green-500/10 text-green-500" : "bg-secondary text-muted-foreground"
                            }
                          >
                            {auto.active ? "Active" : "Paused"}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">{auto.description}</p>

                        {/* Visual Workflow */}
                        <div className="flex items-center gap-2 flex-wrap py-2">
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
                            <auto.triggerIcon className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium text-primary">{auto.trigger}</span>
                          </div>
                          {auto.actions.map((action, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <ArrowRight className="h-4 w-4 text-muted-foreground" />
                              <div className="px-3 py-1.5 rounded-lg bg-secondary border border-border">
                                <span className="text-sm text-foreground">{action.label}</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{auto.runs} runs</span>
                          <span>Last run: {auto.lastRun}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <Switch checked={auto.active} onCheckedChange={() => handleToggle(auto.id)} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              {auto.active ? (
                                <>
                                  <Pause className="h-4 w-4 mr-2" /> Pause
                                </>
                              ) : (
                                <>
                                  <Play className="h-4 w-4 mr-2" /> Activate
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(auto.id)}>
                              <Copy className="h-4 w-4 mr-2" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDelete(auto.id)} className="text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

          {!loading && filteredAutomations.length === 0 && (
            <Card className="border-border bg-card">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Zap className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground">No automations found</h3>
                <p className="text-muted-foreground mt-1">Create your first automation to get started.</p>
                <Button onClick={handleCreateNew} className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Automation
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <LockedFeatureModal
        open={lockedModalOpen}
        onOpenChange={setLockedModalOpen}
        feature="Unlimited Automations"
        requiredPlan="Professional"
      />
    </AppShell>
  )
}
