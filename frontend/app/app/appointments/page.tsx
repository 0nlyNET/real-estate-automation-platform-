"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CalendarPlus, Check, Clock3, MessageSquareText } from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type Lead = { id: string; fullName: string }
type Appointment = {
  id: string
  startsAt: string
  endsAt: string
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show"
  calendarSource: string
  confirmationStatus: "pending" | "confirmed" | "declined"
  followUpStatus: string
  notes?: string | null
  lead: { id: string; fullName: string; phone?: string | null; email?: string | null }
}

type View = "upcoming" | "completed" | "cancelled" | "no_show"

function label(value: string) {
  return value.replaceAll("_", " ")
}

export default function AppointmentsPage() {
  const [items, setItems] = useState<Appointment[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [view, setView] = useState<View>("upcoming")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [open, setOpen] = useState(false)
  const [leadId, setLeadId] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [notes, setNotes] = useState("")
  const [reschedule, setReschedule] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setError("")
    try {
      const [appointments, leadRows] = await Promise.all([
        apiFetch<Appointment[]>("/client/appointments"),
        apiFetch<Lead[]>("/leads?take=200"),
      ])
      setItems(appointments)
      setLeads(Array.isArray(leadRows) ? leadRows : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Appointments could not be loaded")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const visible = useMemo(() => items.filter((item) => {
    if (view === "upcoming") return item.status === "scheduled" || item.status === "confirmed"
    return item.status === view
  }), [items, view])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!leadId || !startsAt) return
    setBusy("create")
    try {
      await apiFetch("/client/appointments", {
        method: "POST",
        body: { leadId, startsAt: new Date(startsAt).toISOString(), notes },
      })
      setOpen(false); setLeadId(""); setStartsAt(""); setNotes("")
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The appointment could not be saved")
    } finally {
      setBusy("")
    }
  }

  async function update(item: Appointment, patch: Record<string, string>) {
    setBusy(item.id)
    setError("")
    try {
      await apiFetch(`/client/appointments/${item.id}`, { method: "PATCH", body: patch })
      setReschedule((current) => ({ ...current, [item.id]: "" }))
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The appointment could not be updated")
    } finally {
      setBusy("")
    }
  }

  return (
    <PageShell title="Appointments" subtitle="Upcoming meetings and the follow-up each one needs.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto">
          {(["upcoming", "completed", "cancelled", "no_show"] as View[]).map((item) => <Button key={item} size="sm" variant={view === item ? "default" : "outline"} onClick={() => setView(item)}>{label(item)}</Button>)}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><CalendarPlus className="mr-2 h-4 w-4" />Schedule appointment</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Schedule an appointment</DialogTitle><DialogDescription>Choose the lead and agreed time. It will appear here and on Today.</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={create}>
              <label className="grid gap-1.5 text-sm">Lead<select required className="h-10 rounded-md border bg-background px-3" value={leadId} onChange={(event) => setLeadId(event.target.value)}><option value="">Choose a lead</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.fullName}</option>)}</select></label>
              <label className="grid gap-1.5 text-sm">Date and time<Input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
              <label className="grid gap-1.5 text-sm">Notes<Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What was agreed?" /></label>
              <Button type="submit" disabled={busy === "create"}>{busy === "create" ? "Saving…" : "Save appointment"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
      {loading ? <div className="text-sm text-muted-foreground">Loading appointments…</div> : null}
      {!loading && !visible.length ? <div className="rounded-xl border border-dashed p-10 text-center"><CalendarPlus className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 font-medium">No {label(view)} appointments.</div><p className="mt-1 text-sm text-muted-foreground">Appointments saved from the lead workflow will appear here.</p></div> : null}

      <div className="space-y-3">
        {visible.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{item.lead.fullName}</h2><Badge variant={item.confirmationStatus === "confirmed" ? "default" : "secondary"}>{label(item.confirmationStatus)}</Badge><Badge variant="outline">{label(item.status)}</Badge></div>
                  <div className="mt-2 flex items-center gap-2 text-sm"><Clock3 className="h-4 w-4 text-muted-foreground" />{new Date(item.startsAt).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                  {item.notes ? <p className="mt-2 text-sm text-muted-foreground">{item.notes}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={`/app/inbox?leadId=${item.lead.id}`}><MessageSquareText className="mr-2 h-4 w-4" />Conversation</Link></Button>{item.confirmationStatus !== "confirmed" && view === "upcoming" ? <Button size="sm" onClick={() => void update(item, { status: "confirmed", confirmationStatus: "confirmed" })} disabled={busy === item.id}><Check className="mr-2 h-4 w-4" />Confirm</Button> : null}{view === "upcoming" ? <Button size="sm" variant="outline" onClick={() => void update(item, { status: "completed", followUpStatus: "due" })} disabled={busy === item.id}>Mark completed</Button> : null}{view === "upcoming" ? <Button size="sm" variant="ghost" onClick={() => void update(item, { status: "cancelled" })} disabled={busy === item.id}>Cancel</Button> : null}</div>
                </div>
                {view === "upcoming" ? <div className="w-full space-y-2 rounded-lg border p-3 lg:w-72"><label className="grid gap-1 text-xs font-medium">New date and time<Input type="datetime-local" value={reschedule[item.id] || ""} onChange={(event) => setReschedule((current) => ({ ...current, [item.id]: event.target.value }))} /></label><Button size="sm" variant="outline" disabled={!reschedule[item.id] || busy === item.id} onClick={() => void update(item, { startsAt: new Date(reschedule[item.id]).toISOString() })}>Reschedule</Button></div> : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  )
}
