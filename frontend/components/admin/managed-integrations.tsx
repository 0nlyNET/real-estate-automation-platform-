"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiFetch } from "@/lib/api"
import { fetchMe, type Me } from "@/lib/me"
import { AlertTriangle, CheckCircle2, KeyRound, Mail, MessageSquareText, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"

type ProviderStatus = {
  configured: boolean
  connected: boolean
  status: "disconnected" | "configured" | "connected" | "error"
  error: string | null
  lastSync: string | null
  accountSid?: string | null
  apiKey?: string | null
  managedByPlatform?: boolean
  display?: {
    fromNumber?: string | null
    fromEmail?: string | null
    fromName?: string | null
    inboundAddress?: string | null
  }
}

type PlatformSummary = {
  twilio: ProviderStatus
  sendgrid: ProviderStatus
}

type TenantSummary = {
  twilio: ProviderStatus
  sendgrid: ProviderStatus
}

type Tenant = {
  id: string
  name: string
  lifecycleStatus: string
}

function statusBadge(status?: ProviderStatus | null) {
  if (status?.status === "connected") return <Badge>Connected</Badge>
  if (status?.status === "configured") return <Badge variant="outline">Test required</Badge>
  if (status?.status === "error") return <Badge variant="destructive">Needs attention</Badge>
  return <Badge variant="secondary">Not configured</Badge>
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Please try again."
}

export default function ManagedIntegrations() {
  const [me, setMe] = useState<Me | null>(null)
  const [platform, setPlatform] = useState<PlatformSummary | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [tenantId, setTenantId] = useState("")
  const [tenant, setTenant] = useState<TenantSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const [twilioAccountSid, setTwilioAccountSid] = useState("")
  const [twilioAuthToken, setTwilioAuthToken] = useState("")
  const [platformTwilioFrom, setPlatformTwilioFrom] = useState("")
  const [platformTwilioTo, setPlatformTwilioTo] = useState("")

  const [sendgridApiKey, setSendgridApiKey] = useState("")
  const [platformSendgridFrom, setPlatformSendgridFrom] = useState("")
  const [platformSendgridTo, setPlatformSendgridTo] = useState("")

  const [tenantTwilioNumber, setTenantTwilioNumber] = useState("")
  const [tenantTwilioTestTo, setTenantTwilioTestTo] = useState("")
  const [tenantFromEmail, setTenantFromEmail] = useState("")
  const [tenantFromName, setTenantFromName] = useState("")
  const [tenantInboundAddress, setTenantInboundAddress] = useState("")
  const [tenantEmailTestTo, setTenantEmailTestTo] = useState("")

  const selectedTenant = useMemo(
    () => tenants.find((item) => item.id === tenantId) || null,
    [tenantId, tenants],
  )

  const loadTenant = useCallback(async (id: string) => {
    if (!id) {
      setTenant(null)
      return
    }
    const result = await apiFetch<TenantSummary>(`/admin/tenants/${id}/integrations`)
    setTenant(result)
    setTenantTwilioNumber(result.twilio.display?.fromNumber || "")
    setTenantFromEmail(result.sendgrid.display?.fromEmail || "")
    setTenantFromName(result.sendgrid.display?.fromName || "")
    setTenantInboundAddress(result.sendgrid.display?.inboundAddress || "")
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const current = await fetchMe()
      setMe(current)
      if (current?.platformRole !== "super_admin") return
      const [platformResult, tenantResult] = await Promise.all([
        apiFetch<PlatformSummary>("/admin/platform-integrations"),
        apiFetch<Tenant[]>("/admin/tenants"),
      ])
      setPlatform(platformResult)
      setTenants(tenantResult)
      const nextTenantId = tenantId || tenantResult[0]?.id || ""
      setTenantId(nextTenantId)
      if (nextTenantId) await loadTenant(nextTenantId)
    } catch (loadError) {
      setError(message(loadError))
    } finally {
      setLoading(false)
    }
  }, [loadTenant, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(key)
    setError("")
    setNotice("")
    try {
      await action()
      setNotice(success)
    } catch (runError) {
      setError(message(runError))
    } finally {
      setBusy(null)
    }
  }

  const savePlatformTwilio = () =>
    run(
      "platform-twilio-save",
      async () => {
        await apiFetch("/admin/platform-integrations/twilio", {
          method: "PUT",
          body: { accountSid: twilioAccountSid, authToken: twilioAuthToken },
        })
        setTwilioAccountSid("")
        setTwilioAuthToken("")
        setPlatform(await apiFetch<PlatformSummary>("/admin/platform-integrations"))
      },
      "Platform Twilio credentials saved. Existing client assignments now require a new test.",
    )

  const testPlatformTwilio = () =>
    run(
      "platform-twilio-test",
      async () => {
        const result = await apiFetch<{ ok: boolean; error?: string }>(
          "/admin/platform-integrations/twilio/test",
          {
            method: "POST",
            body: {
              fromNumber: platformTwilioFrom || undefined,
              toNumber: platformTwilioTo || undefined,
              message: "RealtyTechAI platform Twilio test",
            },
          },
        )
        if (!result.ok) throw new Error(result.error || "Twilio test failed")
        setPlatform(await apiFetch<PlatformSummary>("/admin/platform-integrations"))
      },
      platformTwilioTo ? "Platform Twilio test SMS sent." : "Platform Twilio credentials verified.",
    )

  const savePlatformSendGrid = () =>
    run(
      "platform-sendgrid-save",
      async () => {
        await apiFetch("/admin/platform-integrations/sendgrid", {
          method: "PUT",
          body: { apiKey: sendgridApiKey },
        })
        setSendgridApiKey("")
        setPlatform(await apiFetch<PlatformSummary>("/admin/platform-integrations"))
      },
      "Platform SendGrid API key saved. Existing client assignments now require a new test.",
    )

  const testPlatformSendGrid = () =>
    run(
      "platform-sendgrid-test",
      async () => {
        const result = await apiFetch<{ ok: boolean; error?: string }>(
          "/admin/platform-integrations/sendgrid/test",
          {
            method: "POST",
            body: {
              fromEmail: platformSendgridFrom || undefined,
              toEmail: platformSendgridTo || undefined,
            },
          },
        )
        if (!result.ok) throw new Error(result.error || "SendGrid test failed")
        setPlatform(await apiFetch<PlatformSummary>("/admin/platform-integrations"))
      },
      platformSendgridTo ? "Platform SendGrid test email sent." : "Platform SendGrid credentials verified.",
    )

  const assignTwilio = () =>
    run(
      "tenant-twilio-save",
      async () => {
        await apiFetch(`/admin/tenants/${tenantId}/integrations/twilio`, {
          method: "PUT",
          body: { fromNumber: tenantTwilioNumber },
        })
        await loadTenant(tenantId)
      },
      `Twilio number assigned to ${selectedTenant?.name || "client"}. Run the client test next.`,
    )

  const testTenantTwilio = () =>
    run(
      "tenant-twilio-test",
      async () => {
        const result = await apiFetch<{ ok: boolean; error?: string }>(
          `/admin/tenants/${tenantId}/integrations/twilio/test`,
          {
            method: "POST",
            body: {
              toNumber: tenantTwilioTestTo || undefined,
              message: "RealtyTechAI client connection test",
            },
          },
        )
        if (!result.ok) throw new Error(result.error || "Client Twilio test failed")
        await loadTenant(tenantId)
      },
      tenantTwilioTestTo ? "Client Twilio test SMS sent." : "Client Twilio assignment verified.",
    )

  const assignSendGrid = () =>
    run(
      "tenant-sendgrid-save",
      async () => {
        await apiFetch(`/admin/tenants/${tenantId}/integrations/sendgrid`, {
          method: "PUT",
          body: {
            fromEmail: tenantFromEmail,
            fromName: tenantFromName,
            inboundAddress: tenantInboundAddress,
          },
        })
        await loadTenant(tenantId)
      },
      `SendGrid sender assigned to ${selectedTenant?.name || "client"}. Run the client test next.`,
    )

  const testTenantSendGrid = () =>
    run(
      "tenant-sendgrid-test",
      async () => {
        const result = await apiFetch<{ ok: boolean; error?: string }>(
          `/admin/tenants/${tenantId}/integrations/sendgrid/test`,
          { method: "POST", body: { toEmail: tenantEmailTestTo || undefined } },
        )
        if (!result.ok) throw new Error(result.error || "Client SendGrid test failed")
        await loadTenant(tenantId)
      },
      tenantEmailTestTo ? "Client SendGrid test email sent." : "Client SendGrid assignment verified.",
    )

  const removeTenantProvider = (provider: "twilio" | "sendgrid") =>
    run(
      `tenant-${provider}-remove`,
      async () => {
        await apiFetch(`/admin/tenants/${tenantId}/integrations/${provider}`, {
          method: "DELETE",
        })
        await loadTenant(tenantId)
      },
      `${provider === "twilio" ? "Twilio" : "SendGrid"} removed from ${selectedTenant?.name || "client"}.`,
    )

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading managed integrations…</div>
  }

  if (me?.platformRole !== "super_admin") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Alert variant="destructive">
          <ShieldCheck />
          <AlertTitle>Owner access required</AlertTitle>
          <AlertDescription>
            Platform provider credentials are restricted to the RealtyTechAI owner. Staff can review client readiness from the main admin workspace.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline"><Link href="/admin/dashboard">Return to admin workspace</Link></Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Managed messaging integrations</h1>
          <p className="text-sm text-muted-foreground">
            Save platform secrets once, then assign non-secret routing details to each client.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={Boolean(busy)}>
          <RefreshCw className={busy ? "animate-spin" : undefined} /> Refresh
        </Button>
      </div>

      <Alert>
        <KeyRound />
        <AlertTitle>Secrets stay in the platform workspace</AlertTitle>
        <AlertDescription>
          Clients see connection status only. Saving a replacement platform key marks existing client assignments for retesting without exposing the secret.
        </AlertDescription>
      </Alert>

      {error ? (
        <Alert variant="destructive"><AlertTriangle /><AlertTitle>Action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}
      {notice ? (
        <Alert><CheckCircle2 /><AlertTitle>Saved</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" /> Platform Twilio</CardTitle><p className="text-sm text-muted-foreground">One Account SID and Auth Token for managed client numbers.</p></div>
            {statusBadge(platform?.twilio)}
          </CardHeader>
          <CardContent className="space-y-4">
            {platform?.twilio.accountSid ? <p className="text-sm text-muted-foreground">Saved account: {platform.twilio.accountSid}</p> : null}
            {platform?.twilio.error ? <Alert variant="destructive"><AlertDescription>{platform.twilio.error}</AlertDescription></Alert> : null}
            <div className="space-y-2"><Label>Account SID</Label><Input value={twilioAccountSid} onChange={(event) => setTwilioAccountSid(event.target.value)} placeholder="AC…" autoComplete="off" /></div>
            <div className="space-y-2"><Label>Auth Token</Label><Input type="password" value={twilioAuthToken} onChange={(event) => setTwilioAuthToken(event.target.value)} autoComplete="new-password" /></div>
            <Button onClick={savePlatformTwilio} disabled={Boolean(busy) || !twilioAccountSid || !twilioAuthToken}>Save platform Twilio</Button>
            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Sending number for test</Label><Input value={platformTwilioFrom} onChange={(event) => setPlatformTwilioFrom(event.target.value)} placeholder="+19296395472" /></div>
              <div className="space-y-2"><Label>Recipient for test</Label><Input value={platformTwilioTo} onChange={(event) => setPlatformTwilioTo(event.target.value)} placeholder="+1…" /></div>
            </div>
            <Button variant="outline" onClick={testPlatformTwilio} disabled={Boolean(busy) || !platform?.twilio.configured}>Test platform Twilio</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div><CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> Platform SendGrid</CardTitle><p className="text-sm text-muted-foreground">One API key for managed client sender identities.</p></div>
            {statusBadge(platform?.sendgrid)}
          </CardHeader>
          <CardContent className="space-y-4">
            {platform?.sendgrid.apiKey ? <p className="text-sm text-muted-foreground">Saved key: {platform.sendgrid.apiKey}</p> : null}
            {platform?.sendgrid.error ? <Alert variant="destructive"><AlertDescription>{platform.sendgrid.error}</AlertDescription></Alert> : null}
            <div className="space-y-2"><Label>SendGrid API key</Label><Input type="password" value={sendgridApiKey} onChange={(event) => setSendgridApiKey(event.target.value)} placeholder="SG.…" autoComplete="new-password" /></div>
            <Button onClick={savePlatformSendGrid} disabled={Boolean(busy) || !sendgridApiKey}>Save platform SendGrid</Button>
            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Verified from email</Label><Input type="email" value={platformSendgridFrom} onChange={(event) => setPlatformSendgridFrom(event.target.value)} /></div>
              <div className="space-y-2"><Label>Recipient for test</Label><Input type="email" value={platformSendgridTo} onChange={(event) => setPlatformSendgridTo(event.target.value)} /></div>
            </div>
            <Button variant="outline" onClick={testPlatformSendGrid} disabled={Boolean(busy) || !platform?.sendgrid.configured}>Test platform SendGrid</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client routing assignments</CardTitle>
          <p className="text-sm text-muted-foreground">Assign a dedicated phone number and email identity without giving the client access to provider secrets.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="client">Client</Label>
            <select id="client" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={tenantId} onChange={(event) => { const id = event.target.value; setTenantId(id); void loadTenant(id) }}>
              <option value="">Select a client</option>
              {tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>

          {tenantId ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4"><CardTitle className="text-base">Client Twilio</CardTitle>{statusBadge(tenant?.twilio)}</CardHeader>
                <CardContent className="space-y-4">
                  {tenant?.twilio.error ? <Alert variant="destructive"><AlertDescription>{tenant.twilio.error}</AlertDescription></Alert> : null}
                  <div className="space-y-2"><Label>Assigned sending number</Label><Input value={tenantTwilioNumber} onChange={(event) => setTenantTwilioNumber(event.target.value)} placeholder="+19296395472" /></div>
                  <Button onClick={assignTwilio} disabled={Boolean(busy) || !tenantTwilioNumber}>Save assignment</Button>
                  <div className="space-y-2 border-t pt-4"><Label>Test recipient</Label><Input value={tenantTwilioTestTo} onChange={(event) => setTenantTwilioTestTo(event.target.value)} placeholder="+1…" /></div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={testTenantTwilio} disabled={Boolean(busy) || !tenant?.twilio.configured}>Test client SMS</Button>
                    {tenant?.twilio.configured ? <Button variant="ghost" onClick={() => removeTenantProvider("twilio")} disabled={Boolean(busy)}><Trash2 /> Remove</Button> : null}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4"><CardTitle className="text-base">Client SendGrid</CardTitle>{statusBadge(tenant?.sendgrid)}</CardHeader>
                <CardContent className="space-y-4">
                  {tenant?.sendgrid.error ? <Alert variant="destructive"><AlertDescription>{tenant.sendgrid.error}</AlertDescription></Alert> : null}
                  <div className="space-y-2"><Label>Verified from email</Label><Input type="email" value={tenantFromEmail} onChange={(event) => setTenantFromEmail(event.target.value)} /></div>
                  <div className="space-y-2"><Label>Sender name</Label><Input value={tenantFromName} onChange={(event) => setTenantFromName(event.target.value)} /></div>
                  <div className="space-y-2"><Label>Inbound reply address</Label><Input type="email" value={tenantInboundAddress} onChange={(event) => setTenantInboundAddress(event.target.value)} placeholder="replies+client@reply.example.com" /></div>
                  <Button onClick={assignSendGrid} disabled={Boolean(busy) || !tenantFromEmail}>Save assignment</Button>
                  <div className="space-y-2 border-t pt-4"><Label>Test recipient</Label><Input type="email" value={tenantEmailTestTo} onChange={(event) => setTenantEmailTestTo(event.target.value)} /></div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={testTenantSendGrid} disabled={Boolean(busy) || !tenant?.sendgrid.configured}>Test client email</Button>
                    {tenant?.sendgrid.configured ? <Button variant="ghost" onClick={() => removeTenantProvider("sendgrid")} disabled={Boolean(busy)}><Trash2 /> Remove</Button> : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
