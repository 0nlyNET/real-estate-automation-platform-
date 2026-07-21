"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { apiFetch } from "@/lib/api"
import { PageShell } from "@/app/app/_components/PageShell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

type Lead = {
  id: string
  fullName: string
  email?: string
  phone?: string
  source?: string
  stage: string
  temperature: string
  temperatureReason?: string
  readinessLevel?: string
  mainBlocker?: string | null
  nextMilestone?: string | null
  recommendedNextAction?: string | null
  timeline?: string | null
  budgetRange?: string | null
  estimatedPrice?: string | null
  preapproved?: string | null
  conversationSummary?: string | null
  recommendedTalkingPoints?: string[] | null
  nextFollowUpAt?: string | null
  leadType?: string
  notes?: string
  assignedTo?: string
}

const stages = ["new", "contacted", "qualified", "appointment_set", "showing_scheduled", "offer_out", "under_contract", "closed", "nurture", "lost"]

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const [lead, setLead] = useState<Lead | null>(null)
  const [stage, setStage] = useState("new")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch<Lead>(`/leads/${params.id}`)
      .then((item) => {
        setLead(item)
        setStage(item.stage || "new")
        setNotes(item.notes || "")
      })
      .catch((e) => setError(e?.message || "Failed to load lead"))
  }, [params.id])

  async function save() {
    try {
      setSaving(true)
      setError("")
      const updated = await apiFetch<Lead>(`/leads/${params.id}`, {
        method: "PATCH",
        body: { stage, notes },
      })
      setLead(updated)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Failed to save lead")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageShell title={lead?.fullName || "Lead"} subtitle="Review qualification details and update follow-up status.">
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/app/leads">Back to leads</Link></Button>{lead ? <Button asChild><Link href={`/app/inbox?leadId=${lead.id}`}>Open conversation</Link></Button> : null}</div>
      {error ? <div className="text-sm text-red-500">{error}</div> : null}
      {!lead && !error ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
      {lead ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Email:</span> {lead.email || "Not provided"}</div>
              <div><span className="text-muted-foreground">Phone:</span> {lead.phone || "Not provided"}</div>
              <div><span className="text-muted-foreground">Source:</span> {lead.source || "Unknown"}</div>
              <div><span className="text-muted-foreground">Assigned:</span> {lead.assignedTo || "Unassigned"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Why this lead is here</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">Intent:</span> {(lead.leadType || "Not set").replaceAll("_", " ")}</div>
              <div><span className="text-muted-foreground">Status:</span> {lead.temperature} — {lead.temperatureReason || "Qualification is still in progress."}</div>
              <div><span className="text-muted-foreground">Readiness:</span> {(lead.readinessLevel || "Not set").replaceAll("_", " ")}</div>
              <div><span className="text-muted-foreground">Blocker:</span> {lead.mainBlocker || "None recorded"}</div>
              <div><span className="text-muted-foreground">Timeline:</span> {lead.timeline || "Not known"}</div>
              <div><span className="text-muted-foreground">Budget / expected price:</span> {lead.budgetRange || lead.estimatedPrice || "Not known"}</div>
              <div><span className="text-muted-foreground">Pre-approved:</span> {lead.preapproved || "Not known"}</div>
              <div><span className="text-muted-foreground">Next milestone:</span> {lead.nextMilestone || "Not set"}</div>
              <div><span className="text-muted-foreground">Next action:</span> {lead.recommendedNextAction || "Continue qualification"}</div>
              <div><span className="text-muted-foreground">Follow-up:</span> {lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString() : "Not scheduled"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Conversation summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{lead.conversationSummary || "A summary will appear after the lead replies."}</p>
              {lead.recommendedTalkingPoints?.length ? <div><div className="font-medium">Talking points</div><ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{lead.recommendedTalkingPoints.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Pipeline</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <label className="grid gap-2 text-sm">
                Stage
                <select className="h-10 rounded-md border bg-background px-3" value={stage} onChange={(e) => setStage(e.target.value)}>
                  {stages.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                Notes
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={7} />
              </label>
              <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PageShell>
  )
}
