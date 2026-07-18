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
    } catch (e: any) {
      setError(e?.message || "Failed to save lead")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageShell title={lead?.fullName || "Lead"} subtitle="Review qualification details and update follow-up status.">
      <Button asChild variant="outline"><Link href="/app/leads">Back to leads</Link></Button>
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
