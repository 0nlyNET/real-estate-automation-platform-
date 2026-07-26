"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { API_URL, apiFetch } from "@/lib/api"
import {
  CheckCircle2,
  Clipboard,
  ExternalLink,
  KeyRound,
  Mail,
  MessageSquareText,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react"

const REALTOR_PRO_LOGIN_URL = "https://www.realtor.com/marketing/log-in/"

type Provider = "twilio" | "sendgrid" | "facebook_lead_ads"

type Integration = {
  provider: Provider
  connected: boolean
  status: "connected" | "configured" | "disconnected" | "error"
  lastSync: string | null
  error: string | null
  display?: Record<string, string | null>
}

type TenantSettings = {
  tenantId: string
  intake: {
    configured: boolean
    last4: string | null
    rotatedAt: string | null
    endpointPath: string
  }
}

type Me = { role: string }

type RotatedKey = {
  key: string
  last4: string
  rotatedAt: string
  endpointPath: string
}

type FacebookPage = { id: string; name: string }

type RealtorSetup = {
  provider: "realtor_com"
  configured: boolean
  connected: boolean
  status: "connected" | "configured" | "disconnected" | "error"
  endpointPath: string
  endpointUrl: string | null
  loginName: string
  apiKeyLast4: string | null
  lastSync: string | null
  error: string | null
}

type RealtorCredentials = {
  provider: "realtor_com"
  endpointPath: string
  endpointUrl: string | null
  loginName: string
  apiKey: string
  apiKeyLast4: string
  createdAt: string
  warning: string
}

function statusBadge(item?: Integration | null) {
  if (item?.status === "connected") return <Badge>Connected</Badge>
  if (item?.status === "error") return <Badge variant="destructive">Needs attention</Badge>
  if (item?.status === "configured") return <Badge variant="outline">Test required</Badge>
  return <Badge variant="secondary">Not connected</Badge>
}

function realtorStatusBadge(item?: RealtorSetup | null) {
  if (item?.status === "connected") return <Badge>Connected</Badge>
  if (item?.status === "error") return <Badge variant="destructive">Needs attention</Badge>
  if (item?.status === "configured") return <Badge variant="outline">Awaiting Realtor.com test</Badge>
  return <Badge variant="secondary">Not connected</Badge>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again."
}

async function fetchIntegrationData() {
  return Promise.all([
    apiFetch<Integration[]>("/integrations"),
    apiFetch<TenantSettings>("/settings/tenant"),
    apiFetch<Me>("/me"),
    apiFetch<RealtorSetup>("/integrations/realtor-com"),
  ])
}

export default function IntegrationsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  const [role, setRole] = useState<string>("read_only")
  const [rotatedKey, setRotatedKey] = useState<RotatedKey | null>(null)
  const [realtorSetup, setRealtorSetup] = useState<RealtorSetup | null>(null)
  const [realtorCredentials, setRealtorCredentials] = useState<RealtorCredentials | null>(null)
  const [facebookPages, setFacebookPages] = useState<FacebookPage[]>([])
  const [facebookPageId, setFacebookPageId] = useState("")

  const canManage = role === "owner" || role === "admin"
  const byProvider = useMemo(
    () => new Map(integrations.map((item) => [item.provider, item])),
    [integrations],
  )
  const twilioStatus = byProvider.get("twilio")
  const sendgridStatus = byProvider.get("sendgrid")
  const facebookStatus = byProvider.get("facebook_lead_ads")
  const facebookWebhookUrl = facebookStatus?.display?.webhookUrl || ""

  const load = useCallback(async () => {
    const [items, tenantSettings, me, realtor] = await fetchIntegrationData()
    setIntegrations(items)
    setSettings(tenantSettings)
    setRole(me.role)
    setRealtorSetup(realtor)
  }, [])

  useEffect(() => {
    let alive = true
    fetchIntegrationData()
      .then(([items, tenantSettings, me, realtor]) => {
        if (!alive) return
        setIntegrations(items)
        setSettings(tenantSettings)
        setRole(me.role)
        setRealtorSetup(realtor)
      })
      .catch((error) => {
        if (!alive) return
        toast({
          title: "Could not load connections",
          description: errorMessage(error),
          variant: "destructive",
        })
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [toast])

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast({ title: `${label} copied` })
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the value and copy it manually.",
        variant: "destructive",
      })
    }
  }

  const rotateIntakeKey = async () => {
    setBusy("intake")
    try {
      const result = await apiFetch<RotatedKey>("/settings/intake-key/rotate", {
        method: "POST",
      })
      setRotatedKey(result)
      await load()
      toast({
        title: settings?.intake.configured ? "Intake key rotated" : "Intake key created",
        description: "Copy it now. It will not be shown again.",
      })
    } catch (error) {
      toast({ title: "Could not create intake key", description: errorMessage(error), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const openRealtorPortal = (portal?: Window | null) => {
    if (portal) portal.location.href = REALTOR_PRO_LOGIN_URL
    else window.location.assign(REALTOR_PRO_LOGIN_URL)
  }

  const connectRealtor = async () => {
    const portal = window.open("about:blank", "_blank")
    if (portal) portal.opener = null
    setBusy("realtor-connect")
    try {
      let credentials = realtorCredentials
      if (!realtorSetup?.configured) {
        credentials = await apiFetch<RealtorCredentials>(
          "/integrations/realtor-com/rotate-key",
          { method: "POST" },
        )
        setRealtorCredentials(credentials)
        await load()
      }
      openRealtorPortal(portal)
      toast({
        title: realtorSetup?.connected ? "Realtor.com opened" : "Finish setup in Realtor.com",
        description: credentials?.apiKey
          ? "Copy the setup values, then run Realtor.com’s connection test."
          : "The active secret is hidden. Generate a new key only when it must be entered again.",
      })
    } catch (error) {
      portal?.close()
      toast({ title: "Realtor.com setup failed", description: errorMessage(error), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const rotateRealtorKey = async () => {
    const portal = window.open("about:blank", "_blank")
    if (portal) portal.opener = null
    setBusy("realtor-rotate")
    try {
      const credentials = await apiFetch<RealtorCredentials>(
        "/integrations/realtor-com/rotate-key",
        { method: "POST" },
      )
      setRealtorCredentials(credentials)
      await load()
      openRealtorPortal(portal)
      toast({ title: "New Realtor.com API key created", description: "Copy it now and replace the old key in Realtor.com." })
    } catch (error) {
      portal?.close()
      toast({ title: "Could not generate Realtor.com API key", description: errorMessage(error), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const refreshRealtor = async () => {
    setBusy("realtor-refresh")
    try {
      const result = await apiFetch<RealtorSetup>("/integrations/realtor-com")
      setRealtorSetup(result)
      toast({
        title: result.connected ? "Realtor.com is connected" : "Still waiting for Realtor.com",
        description: result.connected
          ? "The connection test reached RealtyTechAI successfully."
          : "Run Test Connection and Save inside Realtor.com PRO, then check again.",
      })
    } catch (error) {
      toast({ title: "Could not refresh Realtor.com", description: errorMessage(error), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const disconnectRealtor = async () => {
    setBusy("realtor-disconnect")
    try {
      await apiFetch("/integrations/realtor-com", { method: "DELETE" })
      setRealtorCredentials(null)
      await load()
      toast({ title: "Realtor.com disconnected" })
    } catch (error) {
      toast({ title: "Disconnect failed", description: errorMessage(error), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const connectFacebook = async () => {
    setBusy("facebook")
    try {
      const result = await apiFetch<{ url: string }>("/integrations/facebook/connect")
      window.location.assign(result.url)
    } catch (error) {
      toast({ title: "Facebook setup failed", description: errorMessage(error), variant: "destructive" })
      setBusy(null)
    }
  }

  const loadFacebookPages = async () => {
    setBusy("facebook-pages")
    try {
      const result = await apiFetch<{ pages: FacebookPage[] }>("/integrations/facebook/pages")
      setFacebookPages(result.pages)
      if (result.pages.length === 1) setFacebookPageId(result.pages[0].id)
      if (!result.pages.length) {
        toast({ title: "No Facebook Pages found", description: "Use a Facebook account that administers the brokerage Page.", variant: "destructive" })
      }
    } catch (error) {
      toast({ title: "Could not load Facebook Pages", description: errorMessage(error), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const selectFacebookPage = async () => {
    setBusy("facebook-select")
    try {
      await apiFetch("/integrations/facebook/page", {
        method: "POST",
        body: { pageId: facebookPageId },
      })
      await load()
      toast({ title: "Facebook Lead Ads is connected", description: "New Page leads will now enter this workspace." })
    } catch (error) {
      toast({ title: "Facebook Page subscription failed", description: errorMessage(error), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const disconnectFacebook = async () => {
    setBusy("facebook-disconnect")
    try {
      await apiFetch("/integrations/facebook_lead_ads", { method: "DELETE" })
      await load()
      toast({ title: "Facebook Lead Ads disconnected" })
    } catch (error) {
      toast({ title: "Disconnect failed", description: errorMessage(error), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const endpoint = settings
    ? `${API_URL.replace(/\/+$/, "")}${settings.intake.endpointPath}`
    : ""
  const realtorEndpoint = realtorCredentials?.endpointUrl || realtorSetup?.endpointUrl || ""
  const realtorLogin = realtorCredentials?.loginName || realtorSetup?.loginName || ""

  if (loading) {
    return (
      <PageShell title="Connections" subtitle="Review the services connected to this workspace.">
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-64 w-full" />)}
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="Connections"
      subtitle="Connect your lead sources and review the messaging services managed for you."
    >
      <Alert>
        <ShieldCheck />
        <AlertTitle>Twilio and SendGrid are managed by RealtyTechAI</AlertTitle>
        <AlertDescription>
          You never need to enter provider API keys or authentication tokens. Your workspace shows the assigned number, sender, and connection status while RealtyTechAI operations manages the secure credentials and testing.
        </AlertDescription>
      </Alert>

      {!canManage ? (
        <Alert>
          <ShieldCheck />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>An owner or admin must change lead-source connections. Messaging status remains visible to everyone.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" /> SMS service</CardTitle>
              <p className="text-sm text-muted-foreground">Text leads and receive replies in Conversations.</p>
            </div>
            {statusBadge(twilioStatus)}
          </CardHeader>
          <CardContent className="space-y-4">
            {twilioStatus?.error ? <Alert variant="destructive"><AlertTitle>Connection needs attention</AlertTitle><AlertDescription>{twilioStatus.error}</AlertDescription></Alert> : null}
            {twilioStatus?.display?.fromNumber ? (
              <Alert><CheckCircle2 /><AlertTitle>Assigned sending number</AlertTitle><AlertDescription>{twilioStatus.display.fromNumber}</AlertDescription></Alert>
            ) : (
              <p className="text-sm text-muted-foreground">Your RealtyTechAI operator will assign and test a messaging number before launch.</p>
            )}
            <p className="text-xs text-muted-foreground">Contact support to replace the assigned number or investigate a failed connection.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> Email service</CardTitle>
              <p className="text-sm text-muted-foreground">Send approved follow-ups from your business identity.</p>
            </div>
            {statusBadge(sendgridStatus)}
          </CardHeader>
          <CardContent className="space-y-4">
            {sendgridStatus?.error ? <Alert variant="destructive"><AlertTitle>Connection needs attention</AlertTitle><AlertDescription>{sendgridStatus.error}</AlertDescription></Alert> : null}
            {sendgridStatus?.display?.fromEmail ? (
              <Alert><CheckCircle2 /><AlertTitle>Assigned sender</AlertTitle><AlertDescription>{sendgridStatus.display.fromEmail}</AlertDescription></Alert>
            ) : (
              <p className="text-sm text-muted-foreground">Your RealtyTechAI operator will assign and test a verified sender before launch.</p>
            )}
            {sendgridStatus?.display?.inboundAddress ? <p className="text-sm text-muted-foreground">Reply address: {sendgridStatus.display.inboundAddress}</p> : null}
            <p className="text-xs text-muted-foreground">Contact support to change the sender identity or investigate a failed connection.</p>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1"><CardTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5" /> Realtor.com leads</CardTitle><p className="text-sm text-muted-foreground">Send eligible Realtor.com leads into this workspace.</p></div>
            {realtorStatusBadge(realtorSetup)}
          </CardHeader>
          <CardContent className="space-y-5">
            {realtorSetup?.error ? <Alert variant="destructive"><AlertTitle>Connection error</AlertTitle><AlertDescription>{realtorSetup.error}</AlertDescription></Alert> : null}
            {realtorSetup?.connected ? (
              <Alert><CheckCircle2 /><AlertTitle>Realtor.com delivery is verified</AlertTitle><AlertDescription>Realtor.com successfully reached this workspace{realtorSetup.lastSync ? ` on ${new Date(realtorSetup.lastSync).toLocaleString()}` : ""}.</AlertDescription></Alert>
            ) : (
              <Alert><ExternalLink /><AlertTitle>Agent sign-in required</AlertTitle><AlertDescription>The agent or broker uses their own eligible Realtor.com PRO account. RealtyTechAI never asks for that password.</AlertDescription></Alert>
            )}

            {(realtorSetup?.configured || realtorCredentials) ? (
              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <div className="space-y-2"><Label>Application URL</Label><div className="flex gap-2"><Input readOnly value={realtorEndpoint} className="font-mono text-xs" /><Button type="button" variant="outline" size="icon" onClick={() => copy(realtorEndpoint, "Application URL")} disabled={!realtorEndpoint}><Clipboard /><span className="sr-only">Copy Application URL</span></Button></div></div>
                <div className="space-y-2"><Label>Application login name</Label><div className="flex gap-2"><Input readOnly value={realtorLogin} className="font-mono text-xs" /><Button type="button" variant="outline" size="icon" onClick={() => copy(realtorLogin, "Application login name")} disabled={!realtorLogin}><Clipboard /><span className="sr-only">Copy login name</span></Button></div></div>
                <div className="space-y-2"><Label>API key / password</Label>{realtorCredentials?.apiKey ? <div className="flex gap-2"><Input readOnly value={realtorCredentials.apiKey} className="font-mono text-xs" /><Button variant="outline" onClick={() => copy(realtorCredentials.apiKey, "Realtor.com API key")}><Clipboard /> Copy</Button></div> : <Alert><KeyRound /><AlertTitle>Secret key is hidden</AlertTitle><AlertDescription>The active key ends in {realtorSetup?.apiKeyLast4 || "—"}. Generate a replacement only when you need to enter it again.</AlertDescription></Alert>}</div>
              </div>
            ) : null}

            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={connectRealtor} disabled={Boolean(busy)}><ExternalLink /> {realtorSetup?.connected ? "Open Realtor.com PRO" : realtorSetup?.configured ? "Continue setup" : "Connect Realtor.com"}</Button>
                {realtorSetup?.configured && !realtorSetup.connected ? <Button variant="outline" onClick={refreshRealtor} disabled={Boolean(busy)}><RefreshCw className={busy === "realtor-refresh" ? "animate-spin" : undefined} /> Check connection status</Button> : null}
                {realtorSetup?.configured ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" disabled={Boolean(busy)}><KeyRound /> Generate new API key</Button></AlertDialogTrigger>
                    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Generate a new Realtor.com API key?</AlertDialogTitle><AlertDialogDescription>The current key will stop working immediately. Replace it in Realtor.com and run the connection test again.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={rotateRealtorKey}>Generate key</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                  </AlertDialog>
                ) : null}
                {realtorSetup?.configured ? <Button variant="ghost" onClick={disconnectRealtor} disabled={Boolean(busy)}><Unplug /> Disconnect</Button> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1"><CardTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5" /> Website, Zapier, and lead forms</CardTitle><p className="text-sm text-muted-foreground">Send new buyer, seller, renter, or investor leads into this workspace.</p></div>
            {settings?.intake.configured ? <Badge>Ready</Badge> : <Badge variant="secondary">Key required</Badge>}
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="space-y-2"><Label>Lead intake endpoint</Label><div className="flex gap-2"><Input readOnly value={endpoint} className="font-mono text-xs" /><Button variant="outline" size="icon" onClick={() => copy(endpoint, "Endpoint")} disabled={!endpoint}><Clipboard /><span className="sr-only">Copy endpoint</span></Button></div><p className="text-xs text-muted-foreground">POST JSON and include the key in the <code className="font-mono">x-intake-key</code> header.</p></div>
              {canManage ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant={settings?.intake.configured ? "outline" : "default"} disabled={busy === "intake"}>{busy === "intake" ? <RefreshCw className="animate-spin" /> : <KeyRound />}{settings?.intake.configured ? "Rotate key" : "Create key"}</Button></AlertDialogTrigger>
                  <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{settings?.intake.configured ? "Rotate the intake key?" : "Create an intake key?"}</AlertDialogTitle><AlertDialogDescription>{settings?.intake.configured ? "The current key will stop working immediately. Update every connected form and Zap before accepting more leads." : "The key is shown only once. Store it in the form or Zapier connection, never in a public webpage."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={rotateIntakeKey}>{settings?.intake.configured ? "Rotate key" : "Create key"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            {rotatedKey ? <Alert><KeyRound /><AlertTitle>Copy this key now—it will not be shown again</AlertTitle><AlertDescription className="w-full"><div className="mt-2 flex w-full gap-2"><Input readOnly value={rotatedKey.key} className="font-mono text-xs" /><Button variant="outline" onClick={() => copy(rotatedKey.key, "Intake key")}><Clipboard /> Copy</Button></div></AlertDescription></Alert> : settings?.intake.configured ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-primary" /> Active key ends in {settings.intake.last4}.</div> : null}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4"><div className="space-y-1"><CardTitle>Facebook Lead Ads</CardTitle><p className="text-sm text-muted-foreground">Authorize the brokerage Page that owns your lead forms.</p></div>{statusBadge(facebookStatus)}</CardHeader>
          <CardContent className="space-y-4">
            {facebookStatus?.error ? <Alert variant="destructive"><AlertTitle>Connection error</AlertTitle><AlertDescription>{facebookStatus.error}</AlertDescription></Alert> : null}
            {facebookStatus?.display?.pageName ? <Alert><CheckCircle2 /><AlertTitle>Receiving leads from {facebookStatus.display.pageName}</AlertTitle><AlertDescription>Page ID: {facebookStatus.display.pageId}</AlertDescription></Alert> : null}
            {facebookStatus?.status === "configured" && canManage ? (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <div className="font-medium">Finish Page connection</div>
                {!facebookPages.length ? <Button variant="outline" onClick={loadFacebookPages} disabled={Boolean(busy)}><RefreshCw /> Load my Pages</Button> : <><Label htmlFor="facebookPage">Brokerage Page</Label><select id="facebookPage" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={facebookPageId} onChange={(event) => setFacebookPageId(event.target.value)}><option value="">Select a Page</option>{facebookPages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select><Button onClick={selectFacebookPage} disabled={Boolean(busy) || !facebookPageId}>Connect selected Page</Button></>}
              </div>
            ) : null}
            {!facebookWebhookUrl ? <Alert variant="destructive"><AlertTitle>Meta webhook setup is required</AlertTitle><AlertDescription>RealtyTechAI operations must configure the public Facebook webhook before launch.</AlertDescription></Alert> : null}
            {canManage ? <div className="flex flex-wrap gap-2"><Button onClick={connectFacebook} disabled={Boolean(busy)}><ExternalLink /> {facebookStatus?.connected ? "Reconnect Facebook" : facebookStatus?.status === "configured" ? "Reauthorize Facebook" : "Authorize Facebook"}</Button>{facebookStatus?.connected ? <Button variant="ghost" onClick={disconnectFacebook} disabled={Boolean(busy)}><Unplug /> Disconnect</Button> : null}</div> : null}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
