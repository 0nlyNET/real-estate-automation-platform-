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
import { Separator } from "@/components/ui/separator"
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

function statusBadge(item?: Integration) {
  if (item?.status === "connected") {
    return <Badge>Connected</Badge>
  }
  if (item?.status === "error") {
    return <Badge variant="destructive">Needs attention</Badge>
  }
  if (item?.status === "configured") {
    return <Badge variant="outline">Test required</Badge>
  }
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

  const [twilio, setTwilio] = useState({
    accountSid: "",
    authToken: "",
    fromNumber: "",
    toNumber: "",
  })
  const [sendgrid, setSendgrid] = useState({
    apiKey: "",
    fromEmail: "",
    toEmail: "",
  })
  const [facebookPages, setFacebookPages] = useState<FacebookPage[]>([])
  const [facebookPageId, setFacebookPageId] = useState("")

  const canManage = role === "owner" || role === "admin"
  const byProvider = useMemo(
    () => new Map(integrations.map((item) => [item.provider, item])),
    [integrations],
  )
  const twilioStatus = byProvider.get("twilio")
  const twilioWebhookUrl = twilioStatus?.display?.webhookUrl || ""
  const sendgridStatus = byProvider.get("sendgrid")
  const facebookStatus = byProvider.get("facebook_lead_ads")
  const facebookWebhookUrl = facebookStatus?.display?.webhookUrl || ""

  const load = useCallback(async () => {
    const [items, tenantSettings, me] = await fetchIntegrationData()
    setIntegrations(items)
    setSettings(tenantSettings)
    setRole(me.role)
  }, [])

  useEffect(() => {
    let alive = true
    fetchIntegrationData()
      .then(([items, tenantSettings, me]) => {
        if (!alive) return
        setIntegrations(items)
        setSettings(tenantSettings)
        setRole(me.role)
      })
      .catch((error) => {
        if (!alive) return
        toast({
          title: "Could not load integrations",
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
        title: settings?.intake.configured
          ? "Intake key rotated"
          : "Intake key created",
        description: "Copy it now. It will not be shown again.",
      })
    } catch (error: unknown) {
      toast({
        title: "Could not create intake key",
        description: errorMessage(error),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const saveTwilio = async () => {
    setBusy("twilio-save")
    try {
      await apiFetch("/integrations/twilio", {
        method: "PUT",
        body: {
          accountSid: twilio.accountSid,
          authToken: twilio.authToken,
          fromNumber: twilio.fromNumber,
        },
      })
      setTwilio((current) => ({
        ...current,
        accountSid: "",
        authToken: "",
        fromNumber: "",
      }))
      await load()
      toast({
        title: "Twilio credentials saved",
        description: "Run the connection test next.",
      })
    } catch (error: unknown) {
      toast({
        title: "Twilio setup failed",
        description: errorMessage(error),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const testTwilio = async () => {
    setBusy("twilio-test")
    try {
      const result = await apiFetch<{ ok: boolean; error?: string }>(
        "/integrations/twilio/test",
        {
          method: "POST",
          body: {
            toNumber: twilio.toNumber || undefined,
            message: "RealtyTechAI connection test",
          },
        },
      )
      await load()
      if (!result.ok)
        throw new Error(result.error || "Twilio rejected the test")
      toast({
        title: "Twilio is working",
        description: twilio.toNumber
          ? "Test SMS sent."
          : "Credentials verified.",
      })
    } catch (error: unknown) {
      toast({
        title: "Twilio test failed",
        description: errorMessage(error),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const saveSendGrid = async () => {
    setBusy("sendgrid-save")
    try {
      await apiFetch("/integrations/sendgrid", {
        method: "PUT",
        body: { apiKey: sendgrid.apiKey, fromEmail: sendgrid.fromEmail },
      })
      setSendgrid((current) => ({ ...current, apiKey: "" }))
      await load()
      toast({
        title: "SendGrid credentials saved",
        description: "Run the connection test next.",
      })
    } catch (error: unknown) {
      toast({
        title: "SendGrid setup failed",
        description: errorMessage(error),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const testSendGrid = async () => {
    setBusy("sendgrid-test")
    try {
      const result = await apiFetch<{ ok: boolean; error?: string }>(
        "/integrations/sendgrid/test",
        {
          method: "POST",
          body: { toEmail: sendgrid.toEmail || undefined },
        },
      )
      await load()
      if (!result.ok)
        throw new Error(result.error || "SendGrid rejected the test")
      toast({
        title: "SendGrid is working",
        description: sendgrid.toEmail
          ? "Test email sent."
          : "API key verified.",
      })
    } catch (error: unknown) {
      toast({
        title: "SendGrid test failed",
        description: errorMessage(error),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const connectFacebook = async () => {
    setBusy("facebook")
    try {
      const result = await apiFetch<{ url: string }>(
        "/integrations/facebook/connect",
      )
      window.location.assign(result.url)
    } catch (error: unknown) {
      toast({
        title: "Facebook setup failed",
        description: errorMessage(error),
        variant: "destructive",
      })
      setBusy(null)
    }
  }

  const loadFacebookPages = async () => {
    setBusy("facebook-pages")
    try {
      const result = await apiFetch<{ pages: FacebookPage[] }>(
        "/integrations/facebook/pages",
      )
      setFacebookPages(result.pages)
      if (result.pages.length === 1) setFacebookPageId(result.pages[0].id)
      if (!result.pages.length) {
        toast({
          title: "No Facebook Pages found",
          description:
            "Use a Facebook account that administers the brokerage Page.",
          variant: "destructive",
        })
      }
    } catch (error: unknown) {
      toast({
        title: "Could not load Facebook Pages",
        description: errorMessage(error),
        variant: "destructive",
      })
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
      toast({
        title: "Facebook Lead Ads is connected",
        description: "New Page leads will now enter this workspace.",
      })
    } catch (error: unknown) {
      toast({
        title: "Facebook Page subscription failed",
        description: errorMessage(error),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async (provider: Provider) => {
    setBusy(`${provider}-disconnect`)
    try {
      await apiFetch(`/integrations/${provider}`, { method: "DELETE" })
      await load()
      toast({ title: "Integration disconnected" })
    } catch (error: unknown) {
      toast({
        title: "Disconnect failed",
        description: errorMessage(error),
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const endpoint = settings
    ? `${API_URL.replace(/\/+$/, "")}${settings.intake.endpointPath}`
    : ""

  if (loading) {
    return (
      <PageShell
        title="Integrations"
        subtitle="Connect lead sources and communication providers."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-64 w-full" />
          ))}
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="Integrations"
      subtitle="Connect each system once, test it, then start routing real leads."
    >
      {!canManage ? (
        <Alert>
          <ShieldCheck />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>
            An owner or admin must change credentials. You can still review
            connection health.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="h-5 w-5" /> Website, Zapier, and lead forms
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Send new buyer, seller, renter, or investor leads into this
                workspace.
              </p>
            </div>
            {settings?.intake.configured ? (
              <Badge>Ready</Badge>
            ) : (
              <Badge variant="secondary">Key required</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="space-y-2">
                <Label>Lead intake endpoint</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={endpoint}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copy(endpoint, "Endpoint")}
                    disabled={!endpoint}
                  >
                    <Clipboard />
                    <span className="sr-only">Copy endpoint</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  POST JSON and include the key in the{" "}
                  <code className="font-mono">x-intake-key</code> header.
                </p>
              </div>

              {canManage ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant={
                        settings?.intake.configured ? "outline" : "default"
                      }
                      disabled={busy === "intake"}
                    >
                      {busy === "intake" ? (
                        <RefreshCw className="animate-spin" />
                      ) : (
                        <KeyRound />
                      )}
                      {settings?.intake.configured
                        ? "Rotate key"
                        : "Create key"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {settings?.intake.configured
                          ? "Rotate the intake key?"
                          : "Create an intake key?"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {settings?.intake.configured
                          ? "The current key will stop working immediately. Update every connected form and Zap before accepting more leads."
                          : "The key is shown only once. Store it in your form, CRM, or Zapier connection—not in a public webpage."}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={rotateIntakeKey}>
                        {settings?.intake.configured
                          ? "Rotate key"
                          : "Create key"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>

            {rotatedKey ? (
              <Alert>
                <KeyRound />
                <AlertTitle>
                  Copy this key now—it will not be shown again
                </AlertTitle>
                <AlertDescription className="w-full">
                  <div className="mt-2 flex w-full gap-2">
                    <Input
                      readOnly
                      value={rotatedKey.key}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      onClick={() => copy(rotatedKey.key, "Intake key")}
                    >
                      <Clipboard /> Copy
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : settings?.intake.configured ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" /> Active key
                ends in {settings.intake.last4}.
              </div>
            ) : null}

            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="font-medium">Minimum lead payload</div>
              <code className="mt-2 block overflow-x-auto whitespace-pre text-xs text-muted-foreground">
                {`{\n  "fullName": "Jordan Client",\n  "email": "jordan@example.com",\n  "phone": "+1 555 555 0100",\n  "leadType": "buyer",\n  "source": "Website"\n}`}
              </code>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="h-5 w-5" /> Twilio SMS
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Text leads and receive replies in the inbox.
              </p>
            </div>
            {statusBadge(twilioStatus)}
          </CardHeader>
          <CardContent className="space-y-4">
            {twilioStatus?.error ? (
              <Alert variant="destructive">
                <AlertTitle>Connection error</AlertTitle>
                <AlertDescription>{twilioStatus.error}</AlertDescription>
              </Alert>
            ) : null}
            {twilioStatus?.display?.fromNumber ? (
              <p className="text-sm text-muted-foreground">
                Sending number: {twilioStatus.display.fromNumber}
              </p>
            ) : null}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
              <Label htmlFor="twilioWebhook">Inbound message webhook</Label>
              {twilioWebhookUrl ? (
                <div className="flex gap-2">
                  <Input
                    id="twilioWebhook"
                    readOnly
                    value={twilioWebhookUrl}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => copy(twilioWebhookUrl, "Twilio webhook URL")}
                  >
                    <Clipboard />
                    <span className="sr-only">Copy Twilio webhook URL</span>
                  </Button>
                </div>
              ) : (
                <Alert variant="destructive">
                  <AlertTitle>Inbound replies are not ready</AlertTitle>
                  <AlertDescription>
                    The platform administrator must configure the exact public
                    Twilio webhook URL before client onboarding.
                  </AlertDescription>
                </Alert>
              )}
              <p className="text-xs text-muted-foreground">
                In Twilio, open Phone Numbers → Active Numbers → your number →
                Messaging. For “A message comes in,” paste this exact URL,
                select HTTP POST, and save. Twilio signatures depend on an exact
                match, including HTTPS, path, and any query string.
              </p>
            </div>
            {canManage ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="twilioSid">Account SID</Label>
                  <Input
                    id="twilioSid"
                    value={twilio.accountSid}
                    onChange={(event) =>
                      setTwilio({ ...twilio, accountSid: event.target.value })
                    }
                    placeholder="AC..."
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilioToken">Auth token</Label>
                  <Input
                    id="twilioToken"
                    type="password"
                    value={twilio.authToken}
                    onChange={(event) =>
                      setTwilio({ ...twilio, authToken: event.target.value })
                    }
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilioFrom">Twilio phone number</Label>
                  <Input
                    id="twilioFrom"
                    value={twilio.fromNumber}
                    onChange={(event) =>
                      setTwilio({ ...twilio, fromNumber: event.target.value })
                    }
                    placeholder="+15555550100"
                  />
                </div>
                <Button
                  onClick={saveTwilio}
                  disabled={
                    Boolean(busy) ||
                    !twilio.accountSid ||
                    !twilio.authToken ||
                    !twilio.fromNumber
                  }
                >
                  Save Twilio
                </Button>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="twilioTest">Test recipient (optional)</Label>
                  <Input
                    id="twilioTest"
                    value={twilio.toNumber}
                    onChange={(event) =>
                      setTwilio({ ...twilio, toNumber: event.target.value })
                    }
                    placeholder="+15555550101"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={testTwilio}
                    disabled={
                      Boolean(busy) ||
                      (!twilioStatus?.connected &&
                        twilioStatus?.status !== "configured")
                    }
                  >
                    Test connection
                  </Button>
                  {twilioStatus?.connected ||
                  twilioStatus?.status === "configured" ? (
                    <Button
                      variant="ghost"
                      onClick={() => disconnect("twilio")}
                      disabled={Boolean(busy)}
                    >
                      <Unplug /> Disconnect
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" /> SendGrid email
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Send follow-ups from your verified business address.
              </p>
            </div>
            {statusBadge(sendgridStatus)}
          </CardHeader>
          <CardContent className="space-y-4">
            {sendgridStatus?.error ? (
              <Alert variant="destructive">
                <AlertTitle>Connection error</AlertTitle>
                <AlertDescription>{sendgridStatus.error}</AlertDescription>
              </Alert>
            ) : null}
            {sendgridStatus?.display?.fromEmail ? (
              <p className="text-sm text-muted-foreground">
                From: {sendgridStatus.display.fromEmail}
              </p>
            ) : null}
            {canManage ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="sendgridKey">Restricted API key</Label>
                  <Input
                    id="sendgridKey"
                    type="password"
                    value={sendgrid.apiKey}
                    onChange={(event) =>
                      setSendgrid({ ...sendgrid, apiKey: event.target.value })
                    }
                    placeholder="SG..."
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sendgridFrom">Verified from email</Label>
                  <Input
                    id="sendgridFrom"
                    type="email"
                    value={sendgrid.fromEmail}
                    onChange={(event) =>
                      setSendgrid({
                        ...sendgrid,
                        fromEmail: event.target.value,
                      })
                    }
                    placeholder="agent@yourbrokerage.com"
                  />
                </div>
                <Button
                  onClick={saveSendGrid}
                  disabled={
                    Boolean(busy) || !sendgrid.apiKey || !sendgrid.fromEmail
                  }
                >
                  Save SendGrid
                </Button>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="sendgridTest">
                    Test recipient (optional)
                  </Label>
                  <Input
                    id="sendgridTest"
                    type="email"
                    value={sendgrid.toEmail}
                    onChange={(event) =>
                      setSendgrid({ ...sendgrid, toEmail: event.target.value })
                    }
                    placeholder="you@yourbrokerage.com"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={testSendGrid}
                    disabled={
                      Boolean(busy) ||
                      (!sendgridStatus?.connected &&
                        sendgridStatus?.status !== "configured")
                    }
                  >
                    Test connection
                  </Button>
                  {sendgridStatus?.connected ||
                  sendgridStatus?.status === "configured" ? (
                    <Button
                      variant="ghost"
                      onClick={() => disconnect("sendgrid")}
                      disabled={Boolean(busy)}
                    >
                      <Unplug /> Disconnect
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Facebook Lead Ads</CardTitle>
              <p className="text-sm text-muted-foreground">
                Authorize the brokerage Page that owns your lead forms.
              </p>
            </div>
            {statusBadge(facebookStatus)}
          </CardHeader>
          <CardContent className="space-y-4">
            {facebookStatus?.error ? (
              <Alert variant="destructive">
                <AlertTitle>Connection error</AlertTitle>
                <AlertDescription>{facebookStatus.error}</AlertDescription>
              </Alert>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Authorize Facebook, select the brokerage Page, then RealtyTechAI
              subscribes that Page to real-time lead delivery.
            </p>
            {facebookStatus?.display?.pageName ? (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>Receiving leads from {facebookStatus.display.pageName}</AlertTitle>
                <AlertDescription>
                  Page ID: {facebookStatus.display.pageId}
                </AlertDescription>
              </Alert>
            ) : null}
            {facebookStatus?.status === "configured" && canManage ? (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <div className="font-medium">Finish Page connection</div>
                {!facebookPages.length ? (
                  <Button
                    variant="outline"
                    onClick={loadFacebookPages}
                    disabled={Boolean(busy)}
                  >
                    <RefreshCw /> Load my Pages
                  </Button>
                ) : (
                  <>
                    <Label htmlFor="facebookPage">Brokerage Page</Label>
                    <select
                      id="facebookPage"
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={facebookPageId}
                      onChange={(event) => setFacebookPageId(event.target.value)}
                    >
                      <option value="">Select a Page</option>
                      {facebookPages.map((page) => (
                        <option key={page.id} value={page.id}>
                          {page.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      onClick={selectFacebookPage}
                      disabled={Boolean(busy) || !facebookPageId}
                    >
                      Connect selected Page
                    </Button>
                  </>
                )}
              </div>
            ) : null}
            {!facebookWebhookUrl ? (
              <Alert variant="destructive">
                <AlertTitle>Meta webhook setup is required</AlertTitle>
                <AlertDescription>
                  The platform administrator must configure the public Facebook
                  webhook URL and verification token before onboarding clients.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                <Label>Meta webhook callback URL</Label>
                <div className="flex gap-2">
                  <Input readOnly value={facebookWebhookUrl} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copy(facebookWebhookUrl, "Facebook webhook URL")}
                  >
                    <Clipboard />
                    <span className="sr-only">Copy Facebook webhook URL</span>
                  </Button>
                </div>
              </div>
            )}
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={connectFacebook} disabled={Boolean(busy)}>
                  <ExternalLink />{" "}
                  {facebookStatus?.connected
                    ? "Reconnect Facebook"
                    : facebookStatus?.status === "configured"
                      ? "Reauthorize Facebook"
                      : "Authorize Facebook"}
                </Button>
                {facebookStatus?.connected ? (
                  <Button
                    variant="ghost"
                    onClick={() => disconnect("facebook_lead_ads")}
                    disabled={Boolean(busy)}
                  >
                    <Unplug /> Disconnect
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
