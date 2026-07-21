"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

type LeadRow = {
  id: string
  fullName: string
  phone?: string
  email?: string
  source?: string
  stage: string
  leadType: string
  temperature: "hot" | "warm" | "cold"
  temperatureReason?: string
  readinessLevel?: string
  mainBlocker?: string | null
  timeline?: string | null
  budgetRange?: string | null
  estimatedPrice?: string | null
  nextFollowUpAt?: string | null
}

type Filter = "all" | "new" | "hot" | "warm" | "cold" | "buyer" | "seller" | "appointment_set" | "follow_up" | "nurture" | "closed" | "lost"

function words(value?: string | null) {
  return String(value || "Not set").replaceAll("_", " ")
}

export default function LeadsPage() {
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [err, setErr] = useState("")
  const [loadedAt] = useState(() => Date.now())

  useEffect(() => {
    let mounted = true
    apiFetch<LeadRow[]>("/leads?take=200")
      .then((rows) => mounted && setLeads(Array.isArray(rows) ? rows : []))
      .catch((cause) => mounted && setErr(cause instanceof Error ? cause.message : "Leads could not be loaded"))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  const filtered = useMemo(() => {
    const search = q.trim().toLowerCase()
    return leads.filter((lead) => {
      const matchesSearch = !search || `${lead.fullName} ${lead.phone || ""} ${lead.email || ""} ${lead.source || ""}`.toLowerCase().includes(search)
      const matchesFilter = filter === "all"
        || (["hot", "warm", "cold"].includes(filter) && lead.temperature === filter)
        || (["buyer", "seller"].includes(filter) && lead.leadType === filter)
        || (filter === "follow_up" && Boolean(lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() <= loadedAt))
        || (filter === "new" && lead.stage === "new")
        || (["appointment_set", "nurture", "closed", "lost"].includes(filter) && lead.stage === filter)
      return matchesSearch && matchesFilter
    })
  }, [filter, leads, loadedAt, q])

  return (
    <PageShell title="Leads" subtitle="Every person, their readiness, and the next follow-up.">
      <div className="grid gap-2 lg:grid-cols-[1fr_240px_auto]">
        <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search name, phone, email, or source" />
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter leads">
          <option value="all">All leads</option><option value="new">New</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option><option value="buyer">Buyers</option><option value="seller">Sellers</option><option value="appointment_set">Appointment booked</option><option value="follow_up">Follow-up due</option><option value="nurture">Nurturing</option><option value="closed">Closed</option><option value="lost">Lost</option>
        </select>
        <Button variant="outline" onClick={() => { setQ(""); setFilter("all") }}>Clear</Button>
      </div>

      {err ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{err}</div> : null}
      {loading ? <div className="text-sm text-muted-foreground">Loading leads…</div> : null}
      {!loading && !filtered.length ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No leads match this view.</div> : null}

      <div className="space-y-3">
        {filtered.map((lead) => (
          <Card key={lead.id}>
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{lead.fullName}</h2><Badge variant={lead.temperature === "hot" ? "destructive" : "secondary"}>{words(lead.temperature)}</Badge><Badge variant="outline">{words(lead.leadType)}</Badge></div>
                <p className="mt-1 text-sm">{lead.temperatureReason || "Qualification is still in progress."}</p>
                <div className="mt-3 grid gap-x-5 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4"><span>Source: {lead.source || "Unknown"}</span><span>Ready: {words(lead.readinessLevel)}</span><span>Blocker: {lead.mainBlocker || "None recorded"}</span><span>Stage: {words(lead.stage)}</span><span>Timeline: {lead.timeline || "Not known"}</span><span>Budget / price: {lead.budgetRange || lead.estimatedPrice || "Not known"}</span><span className="sm:col-span-2">Next follow-up: {lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString() : "Not scheduled"}</span></div>
              </div>
              <div className="flex shrink-0 gap-2"><Button asChild size="sm" variant="outline"><Link href={`/app/inbox?leadId=${lead.id}`}>Conversation</Link></Button><Button asChild size="sm"><Link href={`/app/leads/${lead.id}`}>Open</Link></Button></div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  )
}
