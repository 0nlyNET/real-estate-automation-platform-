"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api"

type SequenceSummary = { id: string; name: string; active: boolean; leadType?: string; temperature?: string; stepsCount: number }
type SequenceDetail = SequenceSummary & { description?: string; steps: Array<{ id: string; channel: "sms" | "email"; template: string; offsetMinutes: number; approvalStatus: "draft" | "approved" | "rejected"; identityLabel?: string | null; templateVersion: number }> }
type LeadType = "buyer" | "seller" | "investor" | "renter"
type Temperature = "hot" | "warm" | "cold"

export default function AutomationsPage() {
  const [items, setItems] = useState<SequenceSummary[]>([])
  const [selected, setSelected] = useState<SequenceDetail | null>(null)
  const [name, setName] = useState("")
  const [leadType, setLeadType] = useState<LeadType>("buyer")
  const [temperature, setTemperature] = useState<Temperature>("warm")
  const [channel, setChannel] = useState<"sms" | "email">("sms")
  const [offset, setOffset] = useState("0")
  const [template, setTemplate] = useState("")
  const [identityLabel, setIdentityLabel] = useState("")
  const [error, setError] = useState("")

  async function refresh() {
    const list = await apiFetch<SequenceSummary[]>("/sequences")
    setItems(list)
  }

  async function open(id: string) {
    setSelected(await apiFetch<SequenceDetail>(`/sequences/${id}`))
  }

  useEffect(() => { refresh().catch((e) => setError(e?.message || "Failed to load automations")) }, [])

  async function create() {
    try {
      setError("")
      const result = await apiFetch<{ id: string }>("/sequences", {
        method: "POST",
        body: { name: name.trim(), leadType, temperature, active: false },
      })
      setName("")
      await refresh()
      await open(result.id)
    } catch (e: any) { setError(e?.message || "Failed to create automation") }
  }

  async function toggle(item: SequenceSummary) {
    try {
      await apiFetch(`/sequences/${item.id}/toggle`, { method: "PATCH" })
      await refresh()
      if (selected?.id === item.id) await open(item.id)
    } catch (e: any) { setError(e?.message || "Failed to update automation") }
  }

  async function addStep() {
    if (!selected) return
    try {
      await apiFetch(`/sequences/${selected.id}/steps`, {
        method: "POST",
        body: { channel, template: template.trim(), offsetMinutes: Number(offset), identityLabel: identityLabel.trim() },
      })
      setTemplate("")
      setOffset("0")
      setIdentityLabel("")
      await open(selected.id)
      await refresh()
    } catch (e: any) { setError(e?.message || "Failed to add step") }
  }

  async function approveStep(stepId: string, currentIdentity?: string | null) {
    if (!selected) return
    const identity = window.prompt("Confirm the sender identity exactly as it appears in this template", currentIdentity || identityLabel)
    if (!identity) return
    try {
      await apiFetch(`/sequences/${selected.id}/steps/${stepId}/approve`, {
        method: "POST",
        body: { identityLabel: identity },
      })
      await open(selected.id)
      await refresh()
    } catch (e: any) { setError(e?.message || "Template approval failed") }
  }

  async function removeStep(stepId: string) {
    if (!selected) return
    try {
      await apiFetch(`/sequences/${selected.id}/steps/${stepId}`, { method: "DELETE" })
      await open(selected.id)
      await refresh()
    } catch (e: any) { setError(e?.message || "Failed to remove step") }
  }

  return (
    <PageShell title="Automations" subtitle="Build, review, and explicitly approve SMS and email follow-up sequences.">
      {error ? <div className="text-sm text-red-500">{error}</div> : null}
      <Card>
        <CardHeader><CardTitle>Create automation</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New buyer follow-up" />
          <select className="h-10 rounded-md border bg-background px-3" aria-label="Lead type" value={leadType} onChange={(e) => setLeadType(e.target.value as LeadType)}>
            <option value="buyer">Buyer</option><option value="seller">Seller</option><option value="investor">Investor</option><option value="renter">Renter</option>
          </select>
          <select className="h-10 rounded-md border bg-background px-3" aria-label="Lead temperature" value={temperature} onChange={(e) => setTemperature(e.target.value as Temperature)}>
            <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
          </select>
          <Button disabled={!name.trim()} onClick={create}>Create</Button>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Sequences</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded border p-3">
                <button className="text-left" onClick={() => open(item.id)}>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.stepsCount} steps · {item.active ? "active" : "inactive"} · {item.leadType || "no lead type"} / {item.temperature || "no temperature"}
                  </div>
                </button>
                <Button size="sm" variant="outline" onClick={() => toggle(item)}>{item.active ? "Disable" : "Enable"}</Button>
              </div>
            ))}
            {!items.length ? <div className="text-sm text-muted-foreground">No sequences yet.</div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{selected?.name || "Select a sequence"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className="space-y-2">
                  {selected.steps.map((step) => (
                    <div key={step.id} className="rounded border p-3 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{step.channel.toUpperCase()} after {step.offsetMinutes} minutes · {step.approvalStatus} · v{step.templateVersion}</span>
                        <div className="flex gap-2">
                          {step.approvalStatus !== "approved" ? <Button size="sm" variant="outline" onClick={() => approveStep(step.id, step.identityLabel)}>Approve</Button> : null}
                          <Button size="sm" variant="destructive" onClick={() => removeStep(step.id)}>Remove</Button>
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{step.template}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t pt-4">
                  <div className="grid grid-cols-2 gap-2">
                    <select className="h-10 rounded-md border bg-background px-3" value={channel} onChange={(e) => setChannel(e.target.value as "sms" | "email")}>
                      <option value="sms">SMS</option><option value="email">Email</option>
                    </select>
                    <Input type="number" min="0" value={offset} onChange={(e) => setOffset(e.target.value)} placeholder="Delay in minutes" />
                  </div>
                  <Textarea value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Hi {{leadName}}, when can we talk?" />
                  <Input value={identityLabel} onChange={(e) => setIdentityLabel(e.target.value)} placeholder="Sender identity exactly used in the message" />
                  <p className="text-xs text-muted-foreground">SMS must identify the sender and include STOP language. Email must identify the sender and include {"{{unsubscribeUrl}}"}. New or edited content remains inactive until approved.</p>
                  <Button disabled={!template.trim()} onClick={addStep}>Add step</Button>
                </div>
              </>
            ) : <div className="text-sm text-muted-foreground">Choose a sequence to edit its steps.</div>}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
