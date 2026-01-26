"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { LockedFeatureModal } from "@/components/ui/locked-feature-modal"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Search,
  Check,
  ExternalLink,
  Settings,
  RefreshCw,
  AlertCircle,
  Lock,
  Zap,
  Mail,
  Calendar,
  Database,
  MessageSquare,
  FileText,
} from "lucide-react"

type Category = "all" | "crm" | "email" | "calendar" | "ads" | "other"

interface Integration {
  id: string
  name: string
  description: string
  category: "crm" | "email" | "calendar" | "ads" | "other"
  logo: string
  connected: boolean
  status?: "active" | "error" | "syncing"
  lastSync?: string
  isPremium: boolean
}

const mockIntegrations: Integration[] = [
  {
    id: "1",
    name: "Zapier",
    description: "Connect to 5,000+ apps and automate workflows",
    category: "other",
    logo: "/zapier-logo-orange.jpg",
    connected: true,
    status: "active",
    lastSync: "2 min ago",
    isPremium: false,
  },
  {
    id: "2",
    name: "Mailchimp",
    description: "Sync leads to your email marketing campaigns",
    category: "email",
    logo: "/mailchimp-logo-yellow.jpg",
    connected: true,
    status: "active",
    lastSync: "5 min ago",
    isPremium: false,
  },
  {
    id: "3",
    name: "Google Calendar",
    description: "Sync appointments and showings to your calendar",
    category: "calendar",
    logo: "/google-calendar-logo.png",
    connected: true,
    status: "syncing",
    lastSync: "Syncing...",
    isPremium: false,
  },
  {
    id: "4",
    name: "Follow Up Boss",
    description: "Two-way sync with your CRM",
    category: "crm",
    logo: "/follow-up-boss-logo-blue.jpg",
    connected: false,
    isPremium: false,
  },
  {
    id: "5",
    name: "Facebook Lead Ads",
    description: "Automatically import leads from Facebook ads",
    category: "ads",
    logo: "/facebook-logo-blue.jpg",
    connected: true,
    status: "error",
    lastSync: "Error: Token expired",
    isPremium: false,
  },
  {
    id: "6",
    name: "Google Ads",
    description: "Import leads from Google Ads campaigns",
    category: "ads",
    logo: "/google-ads-logo.png",
    connected: false,
    isPremium: false,
  },
  {
    id: "7",
    name: "Salesforce",
    description: "Enterprise CRM integration",
    category: "crm",
    logo: "/salesforce-logo-blue-cloud.jpg",
    connected: false,
    isPremium: true,
  },
  {
    id: "8",
    name: "HubSpot",
    description: "Sync contacts and deals with HubSpot CRM",
    category: "crm",
    logo: "/hubspot-logo-orange.png",
    connected: false,
    isPremium: true,
  },
  {
    id: "9",
    name: "Twilio",
    description: "Send SMS messages via Twilio",
    category: "other",
    logo: "/twilio-logo-red.jpg",
    connected: false,
    isPremium: false,
  },
  {
    id: "10",
    name: "Outlook Calendar",
    description: "Sync with Microsoft Outlook calendar",
    category: "calendar",
    logo: "/outlook-logo-blue.jpg",
    connected: false,
    isPremium: false,
  },
  {
    id: "11",
    name: "Slack",
    description: "Get notifications in your Slack workspace",
    category: "other",
    logo: "/slack-logo-colorful.jpg",
    connected: false,
    isPremium: false,
  },
  {
    id: "12",
    name: "DocuSign",
    description: "Send documents for e-signature",
    category: "other",
    logo: "/docusign-logo-yellow.jpg",
    connected: false,
    isPremium: true,
  },
]

const categoryIcons: Record<Category, React.ElementType> = {
  all: Zap,
  crm: Database,
  email: Mail,
  calendar: Calendar,
  ads: FileText,
  other: MessageSquare,
}

const statusColors = {
  active: "bg-green-500/10 text-green-500 border-green-500/20",
  error: "bg-red-500/10 text-red-500 border-red-500/20",
  syncing: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
}

export default function IntegrationsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [integrations, setIntegrations] = useState<Integration[]>(mockIntegrations)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState<Category>("all")
  const [lockedModalOpen, setLockedModalOpen] = useState(false)
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)
  const [apiKey, setApiKey] = useState("")
  const userPlan = "starter"

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const filteredIntegrations = integrations.filter((i) => {
    const matchesSearch =
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === "all" || i.category === activeCategory
    return matchesSearch && matchesCategory
  })

  const connectedCount = integrations.filter((i) => i.connected).length

  const handleConnect = (integration: Integration) => {
    if (integration.isPremium && userPlan === "starter") {
      setLockedModalOpen(true)
      return
    }
    setSelectedIntegration(integration)
    setConnectModalOpen(true)
  }

  const handleDisconnect = (id: string) => {
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, connected: false, status: undefined, lastSync: undefined } : i)),
    )
    toast({ title: "Disconnected", description: "Integration has been disconnected." })
  }

  const handleSaveConnection = () => {
    if (!selectedIntegration) return
    setIntegrations((prev) =>
      prev.map((i) =>
        i.id === selectedIntegration.id ? { ...i, connected: true, status: "active", lastSync: "Just now" } : i,
      ),
    )
    setConnectModalOpen(false)
    setApiKey("")
    toast({ title: "Connected!", description: `${selectedIntegration.name} has been connected successfully.` })
  }

  const handleReconnect = (id: string) => {
    setIntegrations((prev) => prev.map((i) => (i.id === id ? { ...i, status: "syncing", lastSync: "Syncing..." } : i)))
    setTimeout(() => {
      setIntegrations((prev) => prev.map((i) => (i.id === id ? { ...i, status: "active", lastSync: "Just now" } : i)))
      toast({ title: "Reconnected", description: "Integration is now active." })
    }, 2000)
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Integrations</h1>
            <p className="text-muted-foreground">
              {connectedCount} connected integration{connectedCount !== 1 && "s"}
            </p>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search integrations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-secondary pl-9"
            />
          </div>
          <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as Category)}>
            <TabsList className="bg-secondary">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="crm">CRM</TabsTrigger>
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="calendar">Calendar</TabsTrigger>
              <TabsTrigger value="ads">Ads</TabsTrigger>
              <TabsTrigger value="other">Other</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Integrations Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="border-border bg-card">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <Skeleton className="h-12 w-12 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                    </div>
                    <Skeleton className="h-9 w-full mt-4" />
                  </CardContent>
                </Card>
              ))
            : filteredIntegrations.map((integration) => {
                const CategoryIcon = categoryIcons[integration.category]
                return (
                  <Card
                    key={integration.id}
                    className={`border-border bg-card transition-all ${integration.connected ? "ring-1 ring-primary/50" : ""}`}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <div className="relative">
                          <img
                            src={integration.logo || "/placeholder.svg"}
                            alt={integration.name}
                            className="h-12 w-12 rounded-lg object-cover"
                          />
                          {integration.connected && (
                            <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-green-500 border-2 border-card flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-foreground">{integration.name}</h3>
                            {integration.isPremium && (
                              <Badge
                                variant="outline"
                                className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                              >
                                <Lock className="h-3 w-3 mr-1" />
                                Pro
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{integration.description}</p>
                        </div>
                      </div>

                      {integration.connected && integration.status && (
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                          <Badge variant="outline" className={statusColors[integration.status]}>
                            {integration.status === "active" && <Check className="h-3 w-3 mr-1" />}
                            {integration.status === "error" && <AlertCircle className="h-3 w-3 mr-1" />}
                            {integration.status === "syncing" && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
                            {integration.status.charAt(0).toUpperCase() + integration.status.slice(1)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{integration.lastSync}</span>
                        </div>
                      )}

                      <div className="flex gap-2 mt-4">
                        {integration.connected ? (
                          <>
                            {integration.status === "error" ? (
                              <Button
                                onClick={() => handleReconnect(integration.id)}
                                className="flex-1"
                                variant="default"
                              >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Reconnect
                              </Button>
                            ) : (
                              <Button variant="outline" className="flex-1 bg-transparent">
                                <Settings className="h-4 w-4 mr-2" />
                                Settings
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              className="bg-transparent text-destructive hover:text-destructive"
                              onClick={() => handleDisconnect(integration.id)}
                            >
                              Disconnect
                            </Button>
                          </>
                        ) : (
                          <Button onClick={() => handleConnect(integration)} className="w-full">
                            {integration.isPremium && userPlan === "starter" && <Lock className="h-4 w-4 mr-2" />}
                            Connect
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
        </div>

        {!loading && filteredIntegrations.length === 0 && (
          <Card className="border-border bg-card">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Zap className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground">No integrations found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your search or filters.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Connect Modal */}
      <Dialog open={connectModalOpen} onOpenChange={setConnectModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {selectedIntegration?.name}</DialogTitle>
            <DialogDescription>Enter your API credentials to connect this integration.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-4">
              {selectedIntegration && (
                <img
                  src={selectedIntegration.logo || "/placeholder.svg"}
                  alt={selectedIntegration.name}
                  className="h-12 w-12 rounded-lg"
                />
              )}
              <div>
                <p className="font-medium">{selectedIntegration?.name}</p>
                <p className="text-sm text-muted-foreground">{selectedIntegration?.description}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                className="bg-secondary"
              />
            </div>
            <Button variant="link" className="p-0 h-auto text-primary">
              <ExternalLink className="h-4 w-4 mr-1" />
              View setup guide
            </Button>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setConnectModalOpen(false)} className="flex-1 bg-transparent">
              Cancel
            </Button>
            <Button onClick={handleSaveConnection} className="flex-1" disabled={!apiKey.trim()}>
              Connect
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <LockedFeatureModal
        open={lockedModalOpen}
        onOpenChange={setLockedModalOpen}
        feature="Premium Integrations"
        requiredPlan="Professional"
      />
    </AppShell>
  )
}
