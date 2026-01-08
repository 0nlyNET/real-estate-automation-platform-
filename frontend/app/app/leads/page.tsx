"use client"

import { useState, useEffect } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  Search,
  Plus,
  ArrowUpDown,
  MoreHorizontal,
  Mail,
  Phone,
  MessageSquare,
  Calendar,
  Clock,
  User,
  Tag,
  FileText,
  Send,
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const statusColors: Record<string, string> = {
  New: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Contacted: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  Qualified: "bg-primary/10 text-primary border-primary/20",
  Proposal: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  Won: "bg-green-500/10 text-green-500 border-green-500/20",
  Lost: "bg-destructive/10 text-destructive border-destructive/20",
}

const tagColors: Record<string, string> = {
  Hot: "bg-red-500/10 text-red-500 border-red-500/20",
  Warm: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  Buyer: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Seller: "bg-green-500/10 text-green-500 border-green-500/20",
  Investor: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  Closed: "bg-primary/10 text-primary border-primary/20",
}

const mockLeads = [
  {
    id: "1",
    name: "Sarah Johnson",
    email: "sarah@email.com",
    phone: "+1 (555) 123-4567",
    source: "Facebook Ads",
    status: "New",
    assignedTo: "Jane Doe",
    tags: ["Hot", "Buyer"],
    lastActivity: "2 min ago",
    createdAt: "Today, 10:30 AM",
    notes: "Interested in 3BR homes in downtown area. Budget: $500k-600k",
    timeline: [
      { type: "created", message: "Lead created from Facebook Ads", time: "Today, 10:30 AM" },
      { type: "automation", message: "Auto-reply sent", time: "Today, 10:30 AM" },
    ],
  },
  {
    id: "2",
    name: "Mike Chen",
    email: "mike@email.com",
    phone: "+1 (555) 234-5678",
    source: "Website",
    status: "Contacted",
    assignedTo: "Jane Doe",
    tags: ["Warm", "Seller"],
    lastActivity: "1 hour ago",
    createdAt: "Yesterday, 3:45 PM",
    notes: "Looking to sell their 4BR home. Wants listing price estimate.",
    timeline: [
      { type: "created", message: "Lead created from website form", time: "Yesterday, 3:45 PM" },
      { type: "message", message: "Initial outreach sent", time: "Yesterday, 4:00 PM" },
      { type: "message", message: "Lead replied", time: "Today, 9:15 AM" },
    ],
  },
  {
    id: "3",
    name: "Emily Davis",
    email: "emily@email.com",
    phone: "+1 (555) 345-6789",
    source: "Referral",
    status: "Qualified",
    assignedTo: "John Smith",
    tags: ["Hot", "Investor"],
    lastActivity: "3 hours ago",
    createdAt: "2 days ago",
    notes: "Real estate investor looking for multi-family properties.",
    timeline: [
      { type: "created", message: "Lead added manually", time: "2 days ago" },
      { type: "call", message: "Discovery call completed", time: "Yesterday" },
      { type: "note", message: "Qualified as investor lead", time: "Today, 8:00 AM" },
    ],
  },
  {
    id: "4",
    name: "John Williams",
    email: "john.w@email.com",
    phone: "+1 (555) 456-7890",
    source: "Zapier",
    status: "Proposal",
    assignedTo: "Jane Doe",
    tags: ["Buyer"],
    lastActivity: "5 hours ago",
    createdAt: "1 week ago",
    notes: "First-time buyer. Pre-approved for $400k.",
    timeline: [
      { type: "created", message: "Lead imported via Zapier", time: "1 week ago" },
      { type: "message", message: "Multiple follow-ups sent", time: "Various" },
      { type: "booking", message: "Showing scheduled", time: "Tomorrow, 2:00 PM" },
    ],
  },
  {
    id: "5",
    name: "Lisa Park",
    email: "lisa@email.com",
    phone: "+1 (555) 567-8901",
    source: "Facebook Ads",
    status: "Won",
    assignedTo: "John Smith",
    tags: ["Buyer", "Closed"],
    lastActivity: "1 day ago",
    createdAt: "2 weeks ago",
    notes: "Closed on 123 Oak Street. Great client, ask for referrals.",
    timeline: [
      { type: "created", message: "Lead from Facebook Ads", time: "2 weeks ago" },
      { type: "closed", message: "Deal closed - 123 Oak Street", time: "1 day ago" },
    ],
  },
]

export default function LeadsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState(mockLeads)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [selectedLead, setSelectedLead] = useState<(typeof mockLeads)[0] | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [newNote, setNewNote] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.email.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === "all" || lead.status === statusFilter
    const matchesSource = sourceFilter === "all" || lead.source === sourceFilter
    return matchesSearch && matchesStatus && matchesSource
  })

  const handleLeadClick = (lead: (typeof mockLeads)[0]) => {
    setSelectedLead(lead)
    setDrawerOpen(true)
  }

  const handleStatusChange = (leadId: string, newStatus: string) => {
    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, status: newStatus } : lead)))
    if (selectedLead?.id === leadId) {
      setSelectedLead((prev) => (prev ? { ...prev, status: newStatus } : null))
    }
    toast({
      title: "Status updated",
      description: `Lead status changed to ${newStatus}`,
    })
  }

  const handleAddNote = () => {
    if (!newNote.trim() || !selectedLead) return
    toast({
      title: "Note added",
      description: "Your note has been saved.",
    })
    setNewNote("")
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leads</h1>
            <p className="text-muted-foreground">Manage and track your leads pipeline.</p>
          </div>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90 transition-all hover:scale-[1.02] active:scale-[0.98]">
            <Plus className="mr-2 h-4 w-4" />
            Add Lead
          </Button>
        </div>

        {/* Filters */}
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search leads..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-secondary pl-9"
                />
              </div>
              <div className="flex gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36 bg-secondary">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="New">New</SelectItem>
                    <SelectItem value="Contacted">Contacted</SelectItem>
                    <SelectItem value="Qualified">Qualified</SelectItem>
                    <SelectItem value="Proposal">Proposal</SelectItem>
                    <SelectItem value="Won">Won</SelectItem>
                    <SelectItem value="Lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="w-36 bg-secondary">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="Facebook Ads">Facebook Ads</SelectItem>
                    <SelectItem value="Website">Website</SelectItem>
                    <SelectItem value="Referral">Referral</SelectItem>
                    <SelectItem value="Zapier">Zapier</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" className="bg-transparent">
                  <ArrowUpDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Leads Table */}
        <Card className="border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Lead
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                    Assigned
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hidden xl:table-cell">
                    Tags
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                    Last Activity
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-10 w-10 rounded-full" />
                            <div className="space-y-1">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-3 w-40" />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 hidden md:table-cell">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="px-4 py-4">
                          <Skeleton className="h-6 w-20" />
                        </td>
                        <td className="px-4 py-4 hidden lg:table-cell">
                          <Skeleton className="h-4 w-24" />
                        </td>
                        <td className="px-4 py-4 hidden xl:table-cell">
                          <Skeleton className="h-6 w-16" />
                        </td>
                        <td className="px-4 py-4 hidden sm:table-cell">
                          <Skeleton className="h-4 w-20" />
                        </td>
                        <td className="px-4 py-4">
                          <Skeleton className="h-8 w-8 ml-auto" />
                        </td>
                      </tr>
                    ))
                  : filteredLeads.map((lead) => (
                      <tr
                        key={lead.id}
                        className="border-b border-border transition-colors hover:bg-secondary/50 cursor-pointer"
                        onClick={() => handleLeadClick(lead)}
                      >
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {lead.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-foreground">{lead.name}</p>
                              <p className="text-sm text-muted-foreground">{lead.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-muted-foreground hidden md:table-cell">{lead.source}</td>
                        <td className="px-4 py-4">
                          <Badge variant="outline" className={statusColors[lead.status]}>
                            {lead.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 text-sm text-muted-foreground hidden lg:table-cell">
                          {lead.assignedTo}
                        </td>
                        <td className="px-4 py-4 hidden xl:table-cell">
                          <div className="flex gap-1">
                            {lead.tags.slice(0, 2).map((tag) => (
                              <Badge key={tag} variant="outline" className={`text-xs ${tagColors[tag] || ""}`}>
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-muted-foreground hidden sm:table-cell">
                          {lead.lastActivity}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleLeadClick(lead)
                                }}
                              >
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem>Edit Lead</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {!loading && filteredLeads.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <User className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground">No leads found</h3>
                <p className="text-muted-foreground mt-1">Try adjusting your search or filters.</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Lead Detail Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedLead && (
            <>
              <SheetHeader className="pb-4 border-b border-border">
                <div className="flex items-center gap-4">
                  <Avatar className="h-14 w-14">
                    <AvatarFallback className="bg-primary/10 text-primary text-lg">
                      {selectedLead.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle className="text-xl">{selectedLead.name}</SheetTitle>
                    <p className="text-sm text-muted-foreground">{selectedLead.email}</p>
                  </div>
                </div>
              </SheetHeader>

              <div className="py-6 space-y-6">
                {/* Quick Actions */}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 bg-transparent">
                    <Mail className="h-4 w-4 mr-2" />
                    Email
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 bg-transparent">
                    <Phone className="h-4 w-4 mr-2" />
                    Call
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 bg-transparent">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    SMS
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 bg-transparent">
                    <Calendar className="h-4 w-4 mr-2" />
                    Book
                  </Button>
                </div>

                {/* Status Selector */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Status</label>
                  <Select value={selectedLead.status} onValueChange={(val) => handleStatusChange(selectedLead.id, val)}>
                    <SelectTrigger className="bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="New">New</SelectItem>
                      <SelectItem value="Contacted">Contacted</SelectItem>
                      <SelectItem value="Qualified">Qualified</SelectItem>
                      <SelectItem value="Proposal">Proposal</SelectItem>
                      <SelectItem value="Won">Won</SelectItem>
                      <SelectItem value="Lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="details" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 bg-secondary">
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                  </TabsList>
                  <TabsContent value="details" className="mt-4 space-y-4">
                    <div className="grid gap-4">
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs text-muted-foreground">Phone</p>
                          <p className="text-sm font-medium">{selectedLead.phone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs text-muted-foreground">Source</p>
                          <p className="text-sm font-medium">{selectedLead.source}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs text-muted-foreground">Assigned To</p>
                          <p className="text-sm font-medium">{selectedLead.assignedTo}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs text-muted-foreground">Created</p>
                          <p className="text-sm font-medium">{selectedLead.createdAt}</p>
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Tags</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedLead.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className={tagColors[tag] || ""}>
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="timeline" className="mt-4">
                    <div className="space-y-4">
                      {selectedLead.timeline.map((item, idx) => (
                        <div key={idx} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className="h-2 w-2 rounded-full bg-primary" />
                            {idx < selectedLead.timeline.length - 1 && <div className="w-px flex-1 bg-border" />}
                          </div>
                          <div className="pb-4">
                            <p className="text-sm font-medium text-foreground">{item.message}</p>
                            <p className="text-xs text-muted-foreground">{item.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="notes" className="mt-4 space-y-4">
                    <div className="p-3 rounded-lg bg-secondary/50">
                      <div className="flex items-start gap-2 mb-2">
                        <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <p className="text-sm text-foreground">{selectedLead.notes}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Add a note..."
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        className="bg-secondary resize-none"
                        rows={3}
                      />
                    </div>
                    <Button onClick={handleAddNote} className="w-full" disabled={!newNote.trim()}>
                      <Send className="h-4 w-4 mr-2" />
                      Add Note
                    </Button>
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  )
}
