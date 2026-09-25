"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { apiFetch } from "@/lib/api"
import { PageShell } from "@/app/app/_components/PageShell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { AiConversationControls } from "@/components/ai/conversation-controls"

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

type ChannelEligibility = { allowed: boolean; code?: string; reason?: string }
type LeadEligibility = { leadId: string; sms: ChannelEligibility; email: ChannelEligibility }
type LeadEventRow = { id: string; eventType: string; metadata?: Record<string, unknown> | null; createdAt: string }

function isConsentBlocked(channel: ChannelEligibility | undefined): boolean {
  return channel?.code === "MISSING_AFFIRMATIVE_CONSENT"
}

function eventSummary(event: LeadEventRow): string {
  if (event.eventType === "automation_blocked") {
    return event.metadata?.code === "MISSING_AFFIRMATIVE_CONSENT"
      ? "Automated follow-up blocked — waiting for consent"
      : "Automated follow-up blocked"
  }
  if (event.eventType === "sequence_step_skipped") return "Follow-up step skipped"
  return event.eventType.replaceAll("_", " ")
}

const stages = ["new", "contacted", "qualified", "appointment_set", "showing_scheduled", "offer_out", "under_contract", "closed", "nurture", "lost"]

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const [lead, setLead] = useState<Lead | null>(null)
  const [eligibility, setEligibility] = useState<LeadEligibility | null>(null)
  const [events, setEvents] = useState<LeadEventRow[] | null>(null)
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
    apiFetch<LeadEligibility>(`/compliance/leads/${params.id}/eligibility`)
      .then(setEligibility)
      .catch(() => setEligibility(null))
    apiFetch<LeadEventRow[]>(`/leads/${params.id}/events`)
      .then(setEvents)
      .catch(() => setEvents(null))
  }, [params.id])

  const consentBlocked = isConsentBlocked(eligibility?.sms) || isConsentBlocked(eligibility?.email)

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
      {consentBlocked ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950" role="status">
          <div className="font-medium">Automated follow-up paused — no consent on file for this lead</div>
          <p className="mt-1 text-muted-foreground">Record consent in Compliance, or confirm the lead opts in, to enable automated follow-up.</p>
        </div>
      ) : null}
      {!lead && !error ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
      {lead ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <AiConversationControls leadId={lead.id} />
          </div>
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
          <div className="md:col-span-2">
            <Card>
              <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {!events ? <p className="text-muted-foreground">Loading activity…</p> : null}
                {events?.length === 0 ? <p className="text-muted-foreground">No recorded automation activity yet.</p> : null}
                {events?.map((event) => (
                  <div key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border p-3">
                    <div>
                      <div className="font-medium">{eventSummary(event)}</div>
                      {typeof event.metadata?.reason === "string" ? <div className="text-muted-foreground">{event.metadata.reason}</div> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </PageShell>
  )
}
