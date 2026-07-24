"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { apiFetch } from "@/lib/api"
import { fetchMe } from "@/lib/me"
import { CheckCircle2, Download, ExternalLink, ShieldAlert } from "lucide-react"

type WorkspaceSettings = {
  tenantId: string
  timeZone: string
  quietHoursStart: string
  quietHoursEnd: string
  bookingLink: string
  bookingLinkVerifiedAt?: string | null
  bookingLinkStatus?: "missing" | "test_required" | "verified"
  automationsEnabled: boolean
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [deletionRequested, setDeletionRequested] = useState(false)
  const [deletionNotificationSent, setDeletionNotificationSent] = useState(false)
  const [bookingTestOpened, setBookingTestOpened] = useState(false)
  const [savedBookingLink, setSavedBookingLink] = useState("")

  useEffect(() => {
    let active = true
    Promise.all([
      apiFetch<WorkspaceSettings>("/settings/tenant"),
      fetchMe(),
    ])
      .then(([workspaceSettings, me]) => {
        if (!active) return
        setSettings(workspaceSettings)
        setSavedBookingLink(workspaceSettings.bookingLink || "")
        setCanManage(me?.role === "owner" || me?.role === "admin")
      })
      .catch((loadError: unknown) => {
        if (active) setError(message(loadError, "Settings could not be loaded"))
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  async function saveSettings() {
    if (!settings) return
    setBusy("save")
    setError("")
    setSaved(false)
    try {
      const updated = await apiFetch<WorkspaceSettings>("/settings/tenant", {
        method: "PUT",
        body: {
          timeZone: settings.timeZone,
          quietHoursStart: settings.quietHoursStart,
          quietHoursEnd: settings.quietHoursEnd,
          bookingLink: settings.bookingLink,
          automationsEnabled: settings.automationsEnabled,
        },
      })
      setSettings(updated)
      setSavedBookingLink(updated.bookingLink || "")
      setSaved(true)
    } catch (saveError: unknown) {
      setError(message(saveError, "Settings could not be saved"))
    } finally {
      setBusy(null)
    }
  }

  function openBookingTest() {
    const value = settings?.bookingLink?.trim()
    if (!value) return setError("Enter and save a booking link before testing it")
    try {
      const url = new URL(value)
      if (url.protocol !== "https:") throw new Error("invalid")
      window.open(url.toString(), "_blank", "noopener,noreferrer")
      setBookingTestOpened(true)
      setError("")
    } catch {
      setError("Booking link must be a full HTTPS URL")
    }
  }

  async function confirmBookingLink() {
    setBusy("booking")
    setError("")
    try {
      const updated = await apiFetch<WorkspaceSettings>("/settings/booking-link/verify", { method: "POST" })
      setSettings(updated)
      setSavedBookingLink(updated.bookingLink || "")
      setBookingTestOpened(false)
      setSaved(true)
    } catch (verifyError: unknown) {
      setError(message(verifyError, "Booking link could not be confirmed"))
    } finally {
      setBusy(null)
    }
  }

  async function exportData() {
    setBusy("export")
    setError("")
    try {
      const data = await apiFetch<Record<string, unknown>>("/compliance/export")
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `realtytechai-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (exportError: unknown) {
      setError(message(exportError, "Workspace data could not be exported"))
    } finally {
      setBusy(null)
    }
  }

  async function requestDeletion() {
    setBusy("delete")
    setError("")
    try {
      const result = await apiFetch<{ notificationSent?: boolean }>("/support/contact", {
        method: "POST",
        body: {
          subject: "Workspace deletion request",
          message:
            "The workspace owner confirmed DELETE and requested permanent workspace deletion. Please verify identity, billing cancellation, retention obligations, and backup expiry before deletion.",
        },
      })
      setDeletionRequested(true)
      setDeletionNotificationSent(Boolean(result.notificationSent))
      setDeleteConfirmation("")
    } catch (deleteError: unknown) {
      setError(message(deleteError, "Deletion request could not be submitted"))
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <PageShell title="Settings" subtitle="Workspace preferences and data controls.">
        <div className="text-sm text-muted-foreground">Loading settings...</div>
      </PageShell>
    )
  }

  return (
    <PageShell title="Settings" subtitle="Workspace preferences and data controls.">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Settings saved</AlertTitle>
          <AlertDescription>
            New messages and automations will use these workspace preferences.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Business preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="timezone">Business timezone</Label>
              <Input
                id="timezone"
                value={settings?.timeZone || ""}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, timeZone: event.target.value } : current,
                  )
                }
                placeholder="America/New_York"
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quietStart">Quiet hours start</Label>
              <Input
                id="quietStart"
                type="time"
                value={settings?.quietHoursStart || ""}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? { ...current, quietHoursStart: event.target.value }
                      : current,
                  )
                }
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quietEnd">Quiet hours end</Label>
              <Input
                id="quietEnd"
                type="time"
                value={settings?.quietHoursEnd || ""}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? { ...current, quietHoursEnd: event.target.value }
                      : current,
                  )
                }
                disabled={!canManage}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bookingLink">Booking link</Label>
            <Input
              id="bookingLink"
              type="url"
              value={settings?.bookingLink || ""}
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, bookingLink: event.target.value, bookingLinkStatus: event.target.value ? "test_required" : "missing", bookingLinkVerifiedAt: null } : current,
                )
              }
              placeholder="https://calendly.com/your-team/consultation"
              disabled={!canManage}
            />
            <p className="text-xs text-muted-foreground">
              This link can be inserted into lead follow-ups so prospects can book directly.
            </p>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm"><div className="font-medium">Message preview</div><p className="mt-1 text-muted-foreground">Choose a convenient appointment time here: {settings?.bookingLink || "[your booking link]"}</p></div>
            <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={openBookingTest} disabled={!canManage || !settings?.bookingLink}><ExternalLink /> Open test link</Button><Button type="button" onClick={() => void confirmBookingLink()} disabled={!canManage || !bookingTestOpened || settings?.bookingLink !== savedBookingLink || busy === "booking"}><CheckCircle2 />{busy === "booking" ? "Confirming..." : "I confirmed the correct calendar"}</Button><span className="text-xs text-muted-foreground">{settings?.bookingLinkStatus === "verified" ? "Verified" : settings?.bookingLink !== savedBookingLink ? "Save this link before confirming it" : settings?.bookingLink ? "Test and confirm before this link can be sent" : "Booking link not configured"}</span></div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <div className="font-medium">Automation master switch</div>
              <p className="text-sm text-muted-foreground">
                Pause or resume automated messages across the workspace.
              </p>
            </div>
            <Switch
              checked={Boolean(settings?.automationsEnabled)}
              onCheckedChange={(checked) =>
                setSettings((current) =>
                  current ? { ...current, automationsEnabled: checked } : current,
                )
              }
              disabled={!canManage}
            />
          </div>
          {canManage ? (
            <Button onClick={saveSettings} disabled={busy === "save" || !settings}>
              {busy === "save" ? "Saving..." : "Save preferences"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only an owner or admin can change workspace preferences.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download a portable JSON copy of users, teams, leads, conversations,
            automations, routing, compliance records, support tickets, and audit history.
            Passwords, reset tokens, provider credentials, and Stripe identifiers are excluded.
          </p>
          <Button
            variant="outline"
            onClick={exportData}
            disabled={!canManage || busy === "export"}
          >
            <Download /> {busy === "export" ? "Preparing export..." : "Export workspace data"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" /> Request workspace deletion
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {deletionRequested ? (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Deletion request received</AlertTitle>
              <AlertDescription>
                {deletionNotificationSent
                  ? "Support was notified and will verify ownership, cancel active billing, and confirm the deletion schedule before any data is permanently removed."
                  : "The request was saved, but operator email notification is not configured. Contact the platform operator directly before relying on the deletion schedule."}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                This creates a tracked request. Data is not deleted automatically because
                identity, billing, legal retention, and backup expiry must be verified first.
              </p>
              <div className="max-w-sm space-y-2">
                <Label htmlFor="deleteConfirm">Type DELETE to confirm</Label>
                <Input
                  id="deleteConfirm"
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  disabled={!canManage}
                />
              </div>
              <Button
                variant="destructive"
                onClick={requestDeletion}
                disabled={
                  !canManage || deleteConfirmation !== "DELETE" || busy === "delete"
                }
              >
                {busy === "delete" ? "Submitting..." : "Request deletion"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
