"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { apiFetch } from "@/lib/api"
import { CheckCircle2, Sparkles } from "lucide-react"

type TenantSettings = {
  tenantId: string
  timeZone: string
  quietHoursStart: string
  quietHoursEnd: string
  bookingLink?: string
  automationsEnabled: boolean
}

function isValidHttpUrl(v: string) {
  try {
    const u = new URL(v)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export function GettingStartedCard() {
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [settings, setSettings] = useState<TenantSettings | null>(null)

  // form state
  const [timeZone, setTimeZone] = useState("")
  const [quietStart, setQuietStart] = useState("21:00")
  const [quietEnd, setQuietEnd] = useState("08:00")
  const [bookingLink, setBookingLink] = useState("")
  const [automationsEnabled, setAutomationsEnabled] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const s = await apiFetch<TenantSettings>("/settings/tenant")
        if (!alive) return
        setSettings(s)

        const detectedTz =
          Intl.DateTimeFormat().resolvedOptions().timeZone || s.timeZone || "America/New_York"

        setTimeZone(s.timeZone || detectedTz)
        setQuietStart(s.quietHoursStart || "21:00")
        setQuietEnd(s.quietHoursEnd || "08:00")
        setBookingLink(s.bookingLink || "")
        setAutomationsEnabled(Boolean(s.automationsEnabled))
      } catch (e: any) {
        if (!alive) return
        toast({
          title: "Could not load settings",
          description: e?.message || "Please try again.",
          variant: "destructive",
        })
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [toast])

  const completion = useMemo(() => {
    // Keep this simple: these are the fields that actually affect MVP behavior right now.
    // Timezone + quiet hours determine send scheduling. Booking link helps conversion.
    let total = 3
    let done = 0

    if ((timeZone || "").trim()) done += 1
    if ((quietStart || "").trim() && (quietEnd || "").trim()) done += 1
    if ((bookingLink || "").trim() && isValidHttpUrl(bookingLink.trim())) done += 1

    return { done, total, pct: Math.round((done / total) * 100) }
  }, [timeZone, quietStart, quietEnd, bookingLink])

  const isComplete = completion.pct === 100

  // Hide the card once complete
  if (!loading && isComplete) return null

  const onSave = async () => {
    const tz = timeZone.trim()
    const qs = quietStart.trim()
    const qe = quietEnd.trim()
    const bl = bookingLink.trim()

    if (!tz) {
      toast({ title: "Timezone required", description: "Please select a timezone.", variant: "destructive" })
      return
    }
    if (!qs || !qe) {
      toast({ title: "Quiet hours required", description: "Set a start and end time.", variant: "destructive" })
      return
    }
    if (bl && !isValidHttpUrl(bl)) {
      toast({
        title: "Invalid booking link",
        description: "Use a full http(s) URL, for example https://calendly.com/you/15min",
        variant: "destructive",
      })
      return
    }

    setSaving(true)
    try {
      const updated = await apiFetch<TenantSettings>("/settings/tenant", {
        method: "PUT",
        body: JSON.stringify({
          timeZone: tz,
          quietHoursStart: qs,
          quietHoursEnd: qe,
          bookingLink: bl || undefined,
          automationsEnabled: Boolean(automationsEnabled),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      })

      setSettings(updated)

      toast({
        title: "Saved",
        description: completion.pct >= 67 ? "Almost done." : "Settings updated.",
      })
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message || "Please try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Getting started
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Set this once so messaging and automations run smoothly.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">{completion.pct}% complete</div>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-primary" style={{ width: `${completion.pct}%` }} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tz">Timezone</Label>
                <Input
                  id="tz"
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                  placeholder="America/New_York"
                />
                <p className="text-xs text-muted-foreground">
                  Auto-filled from your browser. Used for quiet hours and scheduling.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Automations</Label>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Enable automations</div>
                    <div className="text-xs text-muted-foreground">Turn sequences on or off.</div>
                  </div>
                  <Switch checked={automationsEnabled} onCheckedChange={setAutomationsEnabled} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quietStart">Quiet hours start</Label>
                <Input
                  id="quietStart"
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                  placeholder="21:00"
                />
                <p className="text-xs text-muted-foreground">24-hour time, for example 21:00.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quietEnd">Quiet hours end</Label>
                <Input
                  id="quietEnd"
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  placeholder="08:00"
                />
                <p className="text-xs text-muted-foreground">24-hour time, for example 08:00.</p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="bookingLink">Booking link (optional but recommended)</Label>
                <Input
                  id="bookingLink"
                  value={bookingLink}
                  onChange={(e) => setBookingLink(e.target.value)}
                  placeholder="https://calendly.com/yourname/15min"
                />
                <p className="text-xs text-muted-foreground">
                  Used in automated follow-ups to convert leads into booked calls.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {completion.pct === 100 ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Ready to go.
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    Finish setup to avoid missed sends during quiet hours.
                  </>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const detected =
                      Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
                    setTimeZone(detected)
                  }}
                  disabled={saving}
                >
                  Auto-fill timezone
                </Button>

                <Button onClick={onSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
