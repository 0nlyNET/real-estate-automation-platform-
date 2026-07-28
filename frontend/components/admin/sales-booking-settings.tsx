"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarDays, ExternalLink, Trash2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiFetch } from "@/lib/api"
import { fetchMe } from "@/lib/me"

type SalesBookingSummary = {
  configured: boolean
  bookingUrl: string | null
  updatedAt: string | null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again."
}

export default function SalesBookingSettings() {
  const [summary, setSummary] = useState<SalesBookingSummary | null>(null)
  const [bookingUrl, setBookingUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [owner, setOwner] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const me = await fetchMe()
      const isOwner = me?.platformRole === "super_admin"
      setOwner(isOwner)
      if (!isOwner) return
      const result = await apiFetch<SalesBookingSummary>("/admin/sales-booking")
      setSummary(result)
      setBookingUrl(result.bookingUrl || "")
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await apiFetch<SalesBookingSummary>("/admin/sales-booking", {
        method: "PUT",
        body: { bookingUrl },
      })
      setSummary(result)
      setBookingUrl(result.bookingUrl || "")
      setNotice("Your RealtyTechAI discovery-call link is now shown to new applicants after they submit the form.")
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await apiFetch<SalesBookingSummary>("/admin/sales-booking", {
        method: "DELETE",
      })
      setSummary(result)
      setBookingUrl("")
      setNotice("The discovery-call link was removed. Applicants will still be saved, but no booking button will appear.")
    } catch (removeError) {
      setError(errorMessage(removeError))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading sales calendar settings…</div>
  }

  if (!owner) return null

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" /> RealtyTechAI inbound discovery calendar
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            This is your own calendar link for people applying to become RealtyTechAI clients. It does not affect brokerage lead calendars.
          </p>
        </div>
        <Badge variant={summary?.configured ? "default" : "secondary"}>
          {summary?.configured ? "Connected" : "Not connected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="destructive"><AlertTitle>Could not save</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {notice ? <Alert><AlertTitle>Saved</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}

        <div className="space-y-2">
          <Label htmlFor="sales-booking-url">Your calendar booking link</Label>
          <Input
            id="sales-booking-url"
            type="url"
            value={bookingUrl}
            onChange={(event) => setBookingUrl(event.target.value)}
            placeholder="https://calendly.com/your-name/realtytechai-discovery"
          />
          <p className="text-xs text-muted-foreground">
            Use an HTTPS Calendly, Cal.com, Google Calendar appointment schedule, or another public booking page.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={busy || !bookingUrl.trim()}>
            {busy ? "Saving…" : "Save discovery calendar"}
          </Button>
          {summary?.bookingUrl ? (
            <Button asChild variant="outline">
              <a href={summary.bookingUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Open link
              </a>
            </Button>
          ) : null}
          {summary?.configured ? (
            <Button variant="ghost" onClick={() => void remove()} disabled={busy}>
              <Trash2 className="mr-2 h-4 w-4" /> Remove
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
