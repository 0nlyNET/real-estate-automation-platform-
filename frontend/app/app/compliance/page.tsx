"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { LockedFeature } from "@/app/app/_components/LockedFeature"
import { apiFetch } from "@/lib/api"
import { fetchMeWithPlan } from "@/lib/me"
import { canUseBrokerage, isAdminRole } from "@/lib/access"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

type QuietHours = {
  enabled: boolean
  startMinute: number
  endMinute: number
  timezone: string
}

type EventRow = {
  id: string
  type: string
  channel?: string | null
  to?: string | null
  createdAt?: string
}

export default function ComplianceAppPage() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [hasEnterprise, setHasEnterprise] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  const [qh, setQh] = useState<QuietHours | null>(null)
  const [optChannel, setOptChannel] = useState<"sms" | "email">("sms")
  const [optValue, setOptValue] = useState("")
  const [events, setEvents] = useState<EventRow[]>([])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        setErr(null)

        const { me, planName } = await fetchMeWithPlan()
        if (!mounted) return

        setHasEnterprise(canUseBrokerage(planName))
        setIsAdmin(isAdminRole(me?.role))

        const q = await apiFetch("/compliance/quiet-hours")
        if (!mounted) return
        setQh(q)

        const ev = await apiFetch("/compliance/events")
        if (!mounted) return
        setEvents(Array.isArray(ev) ? ev : (ev?.items || []))
      } catch (e: any) {
        if (!mounted) return
        setErr(e?.message || "Failed to load compliance")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  async function saveQuietHours() {
    if (!qh) return
    try {
      await apiFetch("/compliance/quiet-hours", { method: "PUT", body: qh })
    } catch (e: any) {
      setErr(e?.message || "Save failed")
    }
  }

  async function addOptOut() {
    const v = optValue.trim()
    if (!v) return
    setOptValue("")
    try {
      await apiFetch("/compliance/optout", { method: "POST", body: { channel: optChannel, value: v } })
      const ev = await apiFetch("/compliance/events")
      setEvents(Array.isArray(ev) ? ev : (ev?.items || []))
    } catch (e: any) {
      setErr(e?.message || "Opt out failed")
    }
  }

  if (!hasEnterprise) {
    return (
      <PageShell title="Compliance" subtitle="Opt-outs, quiet hours, and audit trail.">
        <LockedFeature
          title="Compliance center"
          requiredLabel="Enterprise"
          description="Compliance center requires the Enterprise plan for audit visibility and export. Basic opt-out enforcement still runs server-side when enabled."
        />
      </PageShell>
    )
  }

  return (
    <PageShell title="Compliance" subtitle="Enforce opt-outs and quiet hours. Audit every decision.">
      {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
      {err ? <div className="text-sm text-red-500">{err}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Quiet hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!qh ? (
            <div className="text-sm text-muted-foreground">Loading quiet hours...</div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Switch
                  checked={qh.enabled}
                  onCheckedChange={(v) => setQh({ ...qh, enabled: Boolean(v) })}
                  disabled={!isAdmin}
                />
                <Label>Enabled</Label>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <Input
                  value={String(qh.startMinute)}
                  onChange={(e) => setQh({ ...qh, startMinute: Number(e.target.value || "0") })}
                  placeholder="Start minute (0 to 1439)"
                  disabled={!isAdmin}
                />
                <Input
                  value={String(qh.endMinute)}
                  onChange={(e) => setQh({ ...qh, endMinute: Number(e.target.value || "0") })}
                  placeholder="End minute (0 to 1439)"
                  disabled={!isAdmin}
                />
                <Input
                  value={qh.timezone}
                  onChange={(e) => setQh({ ...qh, timezone: e.target.value })}
                  placeholder="Timezone"
                  disabled={!isAdmin}
                />
              </div>

              <Button onClick={saveQuietHours} disabled={!isAdmin}>Save</Button>
              <div className="text-xs text-muted-foreground">
                Minutes are local time minutes since midnight. Example: 9:00 PM is 1260.
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Opt-outs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isAdmin ? (
            <div className="text-sm text-muted-foreground">Only Owner/Admin can add opt-outs.</div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant={optChannel === "sms" ? "default" : "outline"} onClick={() => setOptChannel("sms")}>
                SMS
              </Button>
              <Button size="sm" variant={optChannel === "email" ? "default" : "outline"} onClick={() => setOptChannel("email")}>
                Email
              </Button>
              <Input value={optValue} onChange={(e) => setOptValue(e.target.value)} placeholder={optChannel === "sms" ? "Phone" : "Email"} />
              <Button onClick={addOptOut}>Add</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compliance events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="divide-y rounded border">
            {events.map((e) => (
              <div key={e.id} className="p-3">
                <div className="text-sm font-medium">{e.type}</div>
                <div className="text-xs text-muted-foreground">
                  {e.channel ? `${e.channel} ` : ""}{e.to ? `to ${e.to}` : ""} {e.createdAt ? `| ${new Date(e.createdAt).toLocaleString()}` : ""}
                </div>
              </div>
            ))}
            {events.length === 0 ? <div className="p-3 text-sm text-muted-foreground">No events yet.</div> : null}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  )
}
