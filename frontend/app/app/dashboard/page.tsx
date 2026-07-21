"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  RefreshCw,
} from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type TodayLead = {
  id: string
  fullName: string
  leadType: string
  temperature: "hot" | "warm" | "cold"
  temperatureReason: string
  source: string
  readiness: string
  blocker?: string | null
  timeline?: string | null
  budget?: string | null
  phone?: string | null
  email?: string | null
  assignedAgent: string
  conversationSummary?: string | null
  talkingPoints: string[]
}

type TodayAction = {
  id: string
  resourceType: "handoff" | "appointment" | "lead" | "message"
  resourceId: string
  kind: "human_handoff" | "appointment" | "follow_up" | "message_problem" | "new_lead"
  priority: "urgent" | "high" | "normal"
  title: string
  reason: string
  nextAction: string
  dueAt?: string | null
  href: string
  primaryAction: "call" | "text" | "email" | "open" | "confirm"
  availableActions: string[]
  lead: TodayLead
  latestMessage?: { body: string; direction: string; createdAt: string } | null
  appointment?: {
    id: string
    startsAt: string
    status: string
    confirmationStatus: string
  } | null
}

type TodayResponse = {
  headline: string
  guidance: string
  actionCount: number
  actions: TodayAction[]
}

function words(value?: string | null) {
  return String(value || "Not set").replaceAll("_", " ")
}

function when(value?: string | null) {
  if (!value) return "No deadline"
  const date = new Date(value)
  const delta = date.getTime() - Date.now()
  const minutes = Math.round(Math.abs(delta) / 60_000)
  if (minutes < 60) return delta < 0 ? `${minutes}m overdue` : `Due in ${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return delta < 0 ? `${hours}h overdue` : `Due in ${hours}h`
  return date.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function ago(value?: string | null) {
  if (!value) return "No messages yet"
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function temperatureClass(value: TodayLead["temperature"]) {
  if (value === "hot") return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
  if (value === "warm") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
}

function oneDayFromNow() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString()
}

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      setData(await apiFetch<TodayResponse>("/client/today?limit=8"))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Today could not be loaded")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function finishHandoff(action: TodayAction, next: "completed" | "snoozed") {
    if (action.resourceType !== "handoff") return
    setBusy(action.id)
    setError("")
    try {
      await apiFetch(`/client/handoffs/${action.resourceId}`, {
        method: "PATCH",
        body: next === "completed"
          ? { action: "completed", note: "Completed from Today" }
          : { action: "snoozed", snoozedUntil: oneDayFromNow() },
      })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be saved")
    } finally {
      setBusy(null)
    }
  }

  async function confirmAppointment(action: TodayAction) {
    if (action.resourceType !== "appointment") return
    setBusy(action.id)
    try {
      await apiFetch(`/client/appointments/${action.resourceId}`, {
        method: "PATCH",
        body: { status: "confirmed", confirmationStatus: "confirmed" },
      })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The appointment could not be confirmed")
    } finally {
      setBusy(null)
    }
  }

  async function markOpened(action: TodayAction) {
    if (action.resourceType !== "handoff") return
    await apiFetch(`/client/handoffs/${action.resourceId}`, {
      method: "PATCH",
      body: { action: "opened" },
    })
  }

  async function openAction(action: TodayAction) {
    setBusy(action.id)
    setError("")
    try {
      await markOpened(action)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The handoff could not be marked open")
    } finally {
      router.push(action.href)
      setBusy(null)
    }
  }

  function primaryButton(action: TodayAction) {
    const disabled = busy === action.id
    if (action.primaryAction === "call" && action.lead.phone) {
      return <Button asChild disabled={disabled}><a onClick={() => void markOpened(action).catch(() => undefined)} href={`tel:+${action.lead.phone.replace(/^\+/, "")}`}><Phone className="mr-2 h-4 w-4" />Call now</a></Button>
    }
    if (action.primaryAction === "email" && action.lead.email) {
      return <Button asChild disabled={disabled}><a onClick={() => void markOpened(action).catch(() => undefined)} href={`mailto:${action.lead.email}`}><Mail className="mr-2 h-4 w-4" />Email</a></Button>
    }
    if (action.primaryAction === "confirm") {
      return <Button disabled={disabled} onClick={() => void confirmAppointment(action)}><Check className="mr-2 h-4 w-4" />Confirm</Button>
    }
    return <Button disabled={disabled} onClick={() => void openAction(action)}>{action.primaryAction === "text" ? <MessageSquareText className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}{action.primaryAction === "text" ? "Text now" : "Open"}</Button>
  }

  return (
    <PageShell title="Today" subtitle="Who needs you, why, and what to do next.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div aria-live="polite">
          <h2 className="text-xl font-semibold">{loading ? "Checking what needs attention…" : data?.headline || "Today is unavailable"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{data?.guidance || "RealtyTechAI is organizing your next steps."}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          <span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>Try again</Button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3" aria-label="Loading today's priorities">
          {[0, 1, 2].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border bg-muted/60" />)}
        </div>
      ) : null}

      {!loading && data?.actions.length ? (
        <div className="space-y-3">
          {data.actions.map((action, index) => (
            <Card key={action.id} className={action.priority === "urgent" ? "border-red-500/50" : ""}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">#{index + 1}</span>
                      <h3 className="text-lg font-semibold">{action.title}</h3>
                      <Badge variant="outline" className={temperatureClass(action.lead.temperature)}>{words(action.lead.temperature)}</Badge>
                      <Badge variant="secondary">{words(action.lead.leadType)}</Badge>
                    </div>
                    <p className="mt-2 text-sm">{action.reason}</p>
                    <div className="mt-3 rounded-lg bg-primary/5 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-primary">Do this next</div>
                      <div className="mt-1 text-sm font-medium">{action.nextAction}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{when(action.dueAt)}</span>
                      <span>From {action.lead.source}</span>
                      <span>Last message {ago(action.latestMessage?.createdAt)}</span>
                      {action.appointment ? <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{words(action.appointment.confirmationStatus)}</span> : null}
                    </div>
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">More context</summary>
                      <div className="mt-3 grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                        <div><span className="text-muted-foreground">Ready:</span> {words(action.lead.readiness)}</div>
                        <div><span className="text-muted-foreground">Blocker:</span> {action.lead.blocker || "None recorded"}</div>
                        <div><span className="text-muted-foreground">Timeline:</span> {action.lead.timeline || "Not known yet"}</div>
                        <div><span className="text-muted-foreground">Budget / price:</span> {action.lead.budget || "Not known yet"}</div>
                        <div><span className="text-muted-foreground">Assigned:</span> {action.lead.assignedAgent}</div>
                        <div><span className="text-muted-foreground">Appointment:</span> {action.appointment ? `${words(action.appointment.status)} · ${words(action.appointment.confirmationStatus)}` : "None scheduled"}</div>
                        {action.latestMessage ? <div className="sm:col-span-2"><span className="text-muted-foreground">Latest message:</span> “{action.latestMessage.body}”</div> : null}
                      </div>
                    </details>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:w-48 lg:justify-end">
                    {primaryButton(action)}
                    <Button variant="outline" disabled={busy === action.id} onClick={() => void openAction(action)}>View</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`More actions for ${action.lead.fullName}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {action.lead.phone ? <DropdownMenuItem asChild><a href={`tel:+${action.lead.phone.replace(/^\+/, "")}`}><Phone className="mr-2 h-4 w-4" />Call</a></DropdownMenuItem> : null}
                        {action.lead.email ? <DropdownMenuItem asChild><a href={`mailto:${action.lead.email}`}><Mail className="mr-2 h-4 w-4" />Email</a></DropdownMenuItem> : null}
                        {action.resourceType === "handoff" ? <DropdownMenuItem onClick={() => void finishHandoff(action, "completed")}><Check className="mr-2 h-4 w-4" />Mark completed</DropdownMenuItem> : null}
                        {action.resourceType === "handoff" ? <DropdownMenuItem onClick={() => void finishHandoff(action, "snoozed")}><Clock3 className="mr-2 h-4 w-4" />Snooze one day</DropdownMenuItem> : null}
                        {action.resourceType === "appointment" ? <DropdownMenuItem asChild><Link href={`/app/appointments?appointmentId=${action.resourceId}`}><CalendarClock className="mr-2 h-4 w-4" />Reschedule</Link></DropdownMenuItem> : null}
                        <DropdownMenuItem asChild><Link href={`/app/leads/${action.lead.id}`}>Add a note</Link></DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {!loading && data && !data.actions.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-600"><Check className="h-6 w-6" /></div>
            <div><h3 className="font-semibold">Nothing needs your attention right now.</h3><p className="mt-1 text-sm text-muted-foreground">You can leave this page. RealtyTechAI will notify you when a lead replies, an appointment changes, or something needs help.</p></div>
            <div className="flex flex-wrap justify-center gap-2"><Button asChild variant="outline"><Link href="/app/leads">View leads</Link></Button><Button asChild variant="outline"><Link href="/app/onboarding">Check setup</Link></Button></div>
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  )
}
