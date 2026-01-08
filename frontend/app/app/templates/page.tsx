"use client"

import { useState, useEffect } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Search,
  Plus,
  Mail,
  MessageSquare,
  FileText,
  MoreHorizontal,
  Copy,
  Trash2,
  Edit,
  Eye,
  Variable,
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type TemplateType = "all" | "email" | "sms" | "script"

interface Template {
  id: string
  name: string
  type: "email" | "sms" | "script"
  subject?: string
  content: string
  variables: string[]
  lastEdited: string
  usedIn: number
}

const mockTemplates: Template[] = [
  {
    id: "1",
    name: "New Lead Welcome",
    type: "email",
    subject: "Welcome to {{company_name}} - Let's Find Your Dream Home!",
    content: `Hi {{first_name}},

Thank you for reaching out! I'm {{agent_name}}, and I'm excited to help you on your real estate journey.

I noticed you're interested in properties in {{area}}. I have some great listings that I think you'll love.

Would you be available for a quick call this week to discuss your needs?

Best regards,
{{agent_name}}
{{company_name}}`,
    variables: ["first_name", "company_name", "agent_name", "area"],
    lastEdited: "2 hours ago",
    usedIn: 3,
  },
  {
    id: "2",
    name: "Appointment Reminder",
    type: "sms",
    content:
      "Hi {{first_name}}! Just a reminder about your property viewing tomorrow at {{time}} for {{property_address}}. Reply YES to confirm or call us to reschedule. - {{agent_name}}",
    variables: ["first_name", "time", "property_address", "agent_name"],
    lastEdited: "1 day ago",
    usedIn: 2,
  },
  {
    id: "3",
    name: "Cold Lead Re-engagement",
    type: "email",
    subject: "Still looking for a home in {{area}}?",
    content: `Hi {{first_name}},

It's been a while since we last connected, and I wanted to check in.

The market in {{area}} has seen some exciting changes lately, and I have some new listings that might interest you.

If you're still in the market, I'd love to catch up and show you what's available.

Let me know if you'd like to schedule a time to chat!

Best,
{{agent_name}}`,
    variables: ["first_name", "area", "agent_name"],
    lastEdited: "3 days ago",
    usedIn: 1,
  },
  {
    id: "4",
    name: "Post-Showing Follow-up",
    type: "email",
    subject: "What did you think of {{property_address}}?",
    content: `Hi {{first_name}},

I hope you enjoyed viewing {{property_address}} today!

I'd love to hear your thoughts. Was there anything you particularly liked or any concerns?

If you'd like to schedule a second viewing or explore similar properties, just let me know.

Looking forward to hearing from you!

{{agent_name}}`,
    variables: ["first_name", "property_address", "agent_name"],
    lastEdited: "5 days ago",
    usedIn: 4,
  },
  {
    id: "5",
    name: "Discovery Call Script",
    type: "script",
    content: `OPENING:
"Hi {{first_name}}, this is {{agent_name}} from {{company_name}}. Thanks for taking my call! Is now still a good time?"

DISCOVERY QUESTIONS:
1. "What's prompting your move right now?"
2. "Are you looking to buy, sell, or both?"
3. "What areas are you most interested in?"
4. "What's your timeline looking like?"
5. "Have you been pre-approved for financing?"

NEXT STEPS:
"Based on what you've shared, I think the best next step would be..."

CLOSING:
"I'll send you some listings that match your criteria. Let's schedule a time to tour some properties. What works better for you - weekdays or weekends?"`,
    variables: ["first_name", "agent_name", "company_name"],
    lastEdited: "1 week ago",
    usedIn: 0,
  },
]

const typeIcons = {
  email: Mail,
  sms: MessageSquare,
  script: FileText,
}

const typeColors = {
  email: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  sms: "bg-green-500/10 text-green-500 border-green-500/20",
  script: "bg-purple-500/10 text-purple-500 border-purple-500/20",
}

export default function TemplatesPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<Template[]>(mockTemplates)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeType, setActiveType] = useState<TemplateType>("all")
  const [editorOpen, setEditorOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [editName, setEditName] = useState("")
  const [editSubject, setEditSubject] = useState("")
  const [editContent, setEditContent] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const filteredTemplates = templates.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.content.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = activeType === "all" || t.type === activeType
    return matchesSearch && matchesType
  })

  const handleEdit = (template: Template) => {
    setSelectedTemplate(template)
    setEditName(template.name)
    setEditSubject(template.subject || "")
    setEditContent(template.content)
    setEditorOpen(true)
  }

  const handleCreate = () => {
    setSelectedTemplate(null)
    setEditName("")
    setEditSubject("")
    setEditContent("")
    setEditorOpen(true)
  }

  const handleSave = () => {
    if (!editName.trim() || !editContent.trim()) {
      toast({ title: "Error", description: "Name and content are required.", variant: "destructive" })
      return
    }

    if (selectedTemplate) {
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === selectedTemplate.id
            ? { ...t, name: editName, subject: editSubject || undefined, content: editContent, lastEdited: "Just now" }
            : t,
        ),
      )
      toast({ title: "Template saved", description: "Your changes have been saved." })
    } else {
      const newTemplate: Template = {
        id: Date.now().toString(),
        name: editName,
        type: "email",
        subject: editSubject || undefined,
        content: editContent,
        variables: extractVariables(editContent + (editSubject || "")),
        lastEdited: "Just now",
        usedIn: 0,
      }
      setTemplates((prev) => [newTemplate, ...prev])
      toast({ title: "Template created", description: "Your new template has been created." })
    }
    setEditorOpen(false)
  }

  const extractVariables = (text: string): string[] => {
    const matches = text.match(/\{\{([^}]+)\}\}/g) || []
    return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))]
  }

  const handleDuplicate = (template: Template) => {
    const newTemplate = {
      ...template,
      id: Date.now().toString(),
      name: `${template.name} (Copy)`,
      lastEdited: "Just now",
      usedIn: 0,
    }
    setTemplates((prev) => [newTemplate, ...prev])
    toast({ title: "Template duplicated", description: `"${newTemplate.name}" created.` })
  }

  const handleDelete = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id))
    toast({ title: "Template deleted", description: "The template has been removed." })
  }

  const insertVariable = (variable: string) => {
    setEditContent((prev) => prev + `{{${variable}}}`)
  }

  const commonVariables = [
    "first_name",
    "last_name",
    "email",
    "phone",
    "agent_name",
    "company_name",
    "property_address",
    "area",
  ]

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Templates</h1>
            <p className="text-muted-foreground">Manage your email, SMS, and call script templates.</p>
          </div>
          <Button
            onClick={handleCreate}
            className="bg-primary text-primary-foreground hover:bg-primary/90 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Template
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-secondary pl-9"
            />
          </div>
          <Tabs value={activeType} onValueChange={(v) => setActiveType(v as TemplateType)}>
            <TabsList className="bg-secondary">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="sms">SMS</TabsTrigger>
              <TabsTrigger value="script">Scripts</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Templates Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="border-border bg-card">
                  <CardContent className="p-5">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-4 w-20 mb-4" />
                    <Skeleton className="h-20 w-full mb-4" />
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-8 w-8" />
                    </div>
                  </CardContent>
                </Card>
              ))
            : filteredTemplates.map((template) => {
                const TypeIcon = typeIcons[template.type]
                return (
                  <Card
                    key={template.id}
                    className="border-border bg-card group hover:border-primary/50 transition-colors"
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <TypeIcon className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-medium text-foreground">{template.name}</h3>
                            <Badge variant="outline" className={`text-xs ${typeColors[template.type]}`}>
                              {template.type.toUpperCase()}
                            </Badge>
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(template)}>
                              <Edit className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(template)}>
                              <Copy className="h-4 w-4 mr-2" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDelete(template.id)} className="text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {template.subject && (
                        <p className="text-sm font-medium text-foreground mb-2 truncate">{template.subject}</p>
                      )}

                      <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{template.content}</p>

                      {template.variables.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-4">
                          {template.variables.slice(0, 3).map((v) => (
                            <Badge key={v} variant="outline" className="text-xs bg-secondary">
                              {`{{${v}}}`}
                            </Badge>
                          ))}
                          {template.variables.length > 3 && (
                            <Badge variant="outline" className="text-xs bg-secondary">
                              +{template.variables.length - 3} more
                            </Badge>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-3 border-t border-border">
                        <span className="text-xs text-muted-foreground">Edited {template.lastEdited}</span>
                        <span className="text-xs text-muted-foreground">Used in {template.usedIn} automations</span>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
        </div>

        {!loading && filteredTemplates.length === 0 && (
          <Card className="border-border bg-card">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground">No templates found</h3>
              <p className="text-muted-foreground mt-1">Create your first template to get started.</p>
              <Button onClick={handleCreate} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Template Editor Sheet */}
      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border">
            <SheetTitle>{selectedTemplate ? "Edit Template" : "Create Template"}</SheetTitle>
          </SheetHeader>

          <div className="py-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name</Label>
              <Input
                id="name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g., New Lead Welcome"
                className="bg-secondary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject Line (for emails)</Label>
              <Input
                id="subject"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="e.g., Welcome to {{company_name}}!"
                className="bg-secondary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">Content</Label>
              <Textarea
                id="content"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Write your template content here..."
                className="bg-secondary min-h-[200px]"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Variable className="h-4 w-4" />
                Insert Variables
              </Label>
              <div className="flex flex-wrap gap-2">
                {commonVariables.map((v) => (
                  <Button
                    key={v}
                    variant="outline"
                    size="sm"
                    className="bg-transparent text-xs"
                    onClick={() => insertVariable(v)}
                  >
                    {`{{${v}}}`}
                  </Button>
                ))}
              </div>
            </div>

            {editContent && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Preview
                </Label>
                <Card className="border-border bg-secondary/50">
                  <CardContent className="p-4">
                    {editSubject && <p className="font-medium text-foreground mb-2">{editSubject}</p>}
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{editContent}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={() => setEditorOpen(false)} className="flex-1 bg-transparent">
                Cancel
              </Button>
              <Button onClick={handleSave} className="flex-1">
                Save Template
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  )
}
