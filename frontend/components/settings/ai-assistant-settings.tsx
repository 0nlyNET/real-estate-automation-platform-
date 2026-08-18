"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Bot, CheckCircle2, PauseCircle, ShieldCheck } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type AiSettings = {
  aiEnabled: boolean
  aiFirstResponderEnabled: boolean
  allowedChannels: Array<"sms" | "email">
  tone: "professional_warm" | "concise" | "friendly"
  bookingBehavior: "calendar_booking" | "verified_link_only" | "handoff" | "disabled"
  responseMode: "human_only" | "draft" | "controlled_autopilot"
  identityLabel?: string | null
  maximumAutomaticTurns: number
  minimumConfidenceThreshold: number
  aiPaused: boolean
  aiPausedReason?: string | null
  configurationApprovalStatus: "draft" | "approved"
}

type BrokerageKnowledge = {
  publicName?: string | null
  officeEmail?: string | null
  officePhone?: string | null
  serviceAreas?: string[] | null
  businessHours?: Record<string, string>
  schedulingInstructions?: string | null
  approvedFaqs?: Array<{ question: string; answer: string }>
  escalationInstructions?: string | null
  qualificationQuestions?: string[] | null
  prohibitedTopics?: string[] | null
  requiredDisclaimer?: string | null
  approvalStatus: "draft" | "approved"
  updatedAt: string
}

type AiConfiguration = {
  assistantStatus: "active" | "paused"
  settings: AiSettings
  knowledge: BrokerageKnowledge
  usage: {
    runs: number
    total: number
    estimatedCostUsd: number
    monthlyLimit: number
  }
  readiness: {
    providerConfigured: boolean
    communications: { sms: boolean; email: boolean }
    verifiedBookingLink: boolean
    googleCalendarConnected: boolean
  }
}

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The action could not be completed"
}

export function AiAssistantSettings({ canManage }: { canManage: boolean }) {
  const [configuration, setConfiguration] =
    useState<AiConfiguration | null>(null)
  const [identity, setIdentity] = useState("")
  const [mode, setMode] =
    useState<AiSettings["responseMode"]>("human_only")
  const [maximumTurns, setMaximumTurns] = useState(6)
  const [firstResponder, setFirstResponder] = useState(true)
  const [allowedChannels, setAllowedChannels] = useState<Array<"sms" | "email">>(["sms", "email"])
  const [tone, setTone] = useState<AiSettings["tone"]>("professional_warm")
  const [bookingBehavior, setBookingBehavior] = useState<AiSettings["bookingBehavior"]>("verified_link_only")
  const [publicName, setPublicName] = useState("")
  const [officeEmail, setOfficeEmail] = useState("")
  const [officePhone, setOfficePhone] = useState("")
  const [serviceAreas, setServiceAreas] = useState("")
  const [businessHours, setBusinessHours] = useState("")
  const [scheduling, setScheduling] = useState("")
  const [faqs, setFaqs] = useState("")
  const [qualificationQuestions, setQualificationQuestions] = useState("")
  const [prohibitedTopics, setProhibitedTopics] = useState("")
  const [escalation, setEscalation] = useState("")
  const [disclaimer, setDisclaimer] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    const next = await apiFetch<AiConfiguration>("/ai/settings")
    setConfiguration(next)
    setIdentity(next.settings.identityLabel || "")
    setMode(next.settings.responseMode)
    setMaximumTurns(next.settings.maximumAutomaticTurns)
    setFirstResponder(next.settings.aiFirstResponderEnabled !== false)
    setAllowedChannels(next.settings.allowedChannels?.length ? next.settings.allowedChannels : ["sms", "email"])
    setTone(next.settings.tone || "professional_warm")
    setBookingBehavior(next.settings.bookingBehavior || "verified_link_only")
    setPublicName(next.knowledge.publicName || "")
    setOfficeEmail(next.knowledge.officeEmail || "")
    setOfficePhone(next.knowledge.officePhone || "")
    setServiceAreas((next.knowledge.serviceAreas || []).join("\n"))
    setBusinessHours(
      Object.values(next.knowledge.businessHours || {}).join("; "),
    )
    setScheduling(next.knowledge.schedulingInstructions || "")
    setFaqs(
      (next.knowledge.approvedFaqs || [])
        .map((item) => `${item.question} | ${item.answer}`)
        .join("\n"),
    )
    setQualificationQuestions(
      (next.knowledge.qualificationQuestions || []).join("\n"),
    )
    setProhibitedTopics((next.knowledge.prohibitedTopics || []).join("\n"))
    setEscalation(next.knowledge.escalationInstructions || "")
    setDisclaimer(next.knowledge.requiredDisclaimer || "")
  }, [])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      void load().catch((cause) => active && setError(message(cause)))
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [load])

  async function action(
    key: string,
    path: string,
    method: "POST" | "PUT",
    body?: Record<string, unknown>,
    success = "AI settings updated.",
  ) {
    setBusy(key)
    setError("")
    setNotice("")
    try {
      const next = await apiFetch<AiConfiguration>(path, { method, body })
      setConfiguration(next)
      await load()
      setNotice(success)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(null)
    }
  }

  function saveSettings() {
    const controlled = mode === "controlled_autopilot"
    if (
      controlled &&
      !window.confirm(
        "Save controlled autopilot mode? It cannot be enabled until the configuration and business information are separately approved.",
      )
    ) {
      return
    }
    void action(
      "settings",
      "/ai/settings",
      "PUT",
      {
        responseMode: mode,
        identityLabel: identity,
        maximumAutomaticTurns: maximumTurns,
        aiFirstResponderEnabled: firstResponder,
        allowedChannels,
        tone,
        bookingBehavior,
        confirmControlledAutopilot: controlled,
      },
      "Assistant preferences saved. Approval is required before enabling AI.",
    )
  }

  function saveKnowledge() {
    const approvedFaqs = lines(faqs).map((line) => {
      const separator = line.indexOf("|")
      return {
        question:
          separator >= 0 ? line.slice(0, separator).trim() : line.trim(),
        answer:
          separator >= 0
            ? line.slice(separator + 1).trim()
            : "A licensed team member will follow up with the verified answer.",
      }
    })
    void action(
      "knowledge",
      "/ai/knowledge",
      "PUT",
      {
        publicName,
        officeEmail: officeEmail || undefined,
        officePhone: officePhone || undefined,
        serviceAreas: lines(serviceAreas),
        businessHours: businessHours.trim()
          ? { general: businessHours.trim() }
          : {},
        schedulingInstructions: scheduling,
        approvedFaqs,
        escalationInstructions: escalation,
        qualificationQuestions: lines(qualificationQuestions),
        prohibitedTopics: lines(prohibitedTopics),
        requiredDisclaimer: disclaimer,
      },
      "Business information saved as a draft. AI remains disabled until reapproved.",
    )
  }

  if (!configuration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" /> AI assistant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {error || "Loading assistant settings…"}
          </p>
        </CardContent>
      </Card>
    )
  }

  const usagePercent = Math.min(
    Math.round(
      (configuration.usage.total /
        Math.max(configuration.usage.monthlyLimit, 1)) *
        100,
    ),
    100,
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" /> AI assistant
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              A disclosed assistant for permitted lead conversations. People
              keep final authority.
            </p>
          </div>
          <Badge
            variant={
              configuration.assistantStatus === "active"
                ? "default"
                : "secondary"
            }
          >
            {configuration.assistantStatus === "active"
              ? "Active"
              : "Paused"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3 text-sm">
            <div className="font-medium">Configuration</div>
            <div className="mt-1 text-muted-foreground">
              {configuration.settings.configurationApprovalStatus ===
              "approved"
                ? "Approved"
                : "Approval required"}
            </div>
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="font-medium">Business information</div>
            <div className="mt-1 text-muted-foreground">
              {configuration.knowledge.approvalStatus === "approved"
                ? "Approved"
                : "Approval required"}
            </div>
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="font-medium">Activity this month</div>
            <div className="mt-1 text-muted-foreground">
              {configuration.usage.runs} runs · {usagePercent}% of workspace
              limit
              {configuration.usage.estimatedCostUsd
                ? ` · ${configuration.usage.estimatedCostUsd.toLocaleString(
                    undefined,
                    { style: "currency", currency: "USD" },
                  )} estimated`
                : ""}
            </div>
          </div>
        </div>

        <section className="space-y-4">
          <div>
            <h3 className="font-medium">Assistant preferences</h3>
            <p className="text-sm text-muted-foreground">
              Changing these preferences disables AI until an owner or admin
              reviews and approves them again.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="aiMode">Response mode</Label>
              <select
                id="aiMode"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as AiSettings["responseMode"])
                }
                disabled={!canManage}
              >
                <option value="human_only">Human only</option>
                <option value="draft">Draft for approval</option>
                <option value="controlled_autopilot">
                  Controlled autopilot
                </option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="aiIdentity">Approved AI identity</Label>
              <Input
                id="aiIdentity"
                value={identity}
                onChange={(event) => setIdentity(event.target.value)}
                placeholder={`Virtual assistant for ${publicName || "your team"}`}
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aiTurns">Maximum automated turns</Label>
              <Input
                id="aiTurns"
                type="number"
                min={1}
                max={25}
                value={maximumTurns}
                onChange={(event) =>
                  setMaximumTurns(Number(event.target.value || 1))
                }
                disabled={!canManage}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={firstResponder} onChange={(event) => setFirstResponder(event.target.checked)} disabled={!canManage} />
              <span><span className="block font-medium">Automatic first response</span><span className="text-muted-foreground">When approved autopilot and all deterministic gates pass, AI responds without a per-lead start button.</span></span>
            </label>
            <div className="rounded-lg border p-3 text-sm">
              <div className="font-medium">Allowed AI channels</div>
              <div className="mt-2 flex gap-4">
                {(["sms", "email"] as const).map((channel) => <label key={channel} className="flex items-center gap-2"><input type="checkbox" checked={allowedChannels.includes(channel)} disabled={!canManage || (allowedChannels.length === 1 && allowedChannels.includes(channel))} onChange={(event) => setAllowedChannels((current) => event.target.checked ? [...new Set([...current, channel])] : current.filter((item) => item !== channel))} />{channel.toUpperCase()}</label>)}
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="aiTone">Tone</Label><select id="aiTone" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={tone} onChange={(event) => setTone(event.target.value as AiSettings["tone"])} disabled={!canManage}><option value="professional_warm">Professional and warm</option><option value="concise">Concise</option><option value="friendly">Friendly</option></select></div>
            <div className="space-y-2"><Label htmlFor="aiBooking">Booking behavior</Label><select id="aiBooking" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={bookingBehavior} onChange={(event) => setBookingBehavior(event.target.value as AiSettings["bookingBehavior"])} disabled={!canManage}><option value="calendar_booking" disabled={!configuration?.readiness.googleCalendarConnected}>Book verified Google Calendar times</option><option value="verified_link_only">Send verified booking link only</option><option value="handoff">Hand off booking requests</option><option value="disabled">Do not handle booking</option></select><p className="text-xs text-muted-foreground">Calendar booking never offers an unverified time and requires a connected, tested Google Calendar. {!configuration?.readiness.googleCalendarConnected ? <Link className="underline" href="/app/integrations">Finish calendar setup</Link> : null}</p></div>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={saveSettings}
              >
                Save preferences
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() =>
                  void action(
                    "approve-settings",
                    "/ai/settings/approve",
                    "POST",
                    undefined,
                    "Assistant configuration approved.",
                  )
                }
              >
                <ShieldCheck /> Approve configuration
              </Button>
              <Button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void action(
                    "enable",
                    "/ai/settings",
                    "PUT",
                    {
                      aiEnabled: !configuration.settings.aiEnabled,
                    },
                    configuration.settings.aiEnabled
                      ? "AI assistant disabled."
                      : "AI assistant enabled.",
                  )
                }
              >
                {configuration.settings.aiEnabled
                  ? "Disable assistant"
                  : "Enable approved assistant"}
              </Button>
            </div>
          ) : null}
        </section>

        <section className="space-y-4 border-t pt-6">
          <div>
            <h3 className="font-medium">Approved business information</h3>
            <p className="text-sm text-muted-foreground">
              The assistant may use only information saved and approved here.
              It cannot browse the web.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Public brokerage or team name">
              <Input
                value={publicName}
                onChange={(event) => setPublicName(event.target.value)}
                disabled={!canManage}
              />
            </Field>
            <Field label="Office email">
              <Input
                type="email"
                value={officeEmail}
                onChange={(event) => setOfficeEmail(event.target.value)}
                disabled={!canManage}
              />
            </Field>
            <Field label="Office phone">
              <Input
                value={officePhone}
                onChange={(event) => setOfficePhone(event.target.value)}
                disabled={!canManage}
              />
            </Field>
            <Field label="Business hours">
              <Input
                value={businessHours}
                onChange={(event) => setBusinessHours(event.target.value)}
                placeholder="Monday–Friday, 9 AM–5 PM"
                disabled={!canManage}
              />
            </Field>
            <Field label="Service areas, one per line">
              <Textarea
                value={serviceAreas}
                onChange={(event) => setServiceAreas(event.target.value)}
                rows={4}
                disabled={!canManage}
              />
            </Field>
            <Field label="Scheduling instructions">
              <Textarea
                value={scheduling}
                onChange={(event) => setScheduling(event.target.value)}
                rows={4}
                disabled={!canManage}
              />
            </Field>
            <Field label="Approved FAQs, one “question | answer” per line">
              <Textarea
                value={faqs}
                onChange={(event) => setFaqs(event.target.value)}
                rows={5}
                disabled={!canManage}
              />
            </Field>
            <Field label="Approved qualification questions, one per line">
              <Textarea
                value={qualificationQuestions}
                onChange={(event) =>
                  setQualificationQuestions(event.target.value)
                }
                rows={5}
                disabled={!canManage}
              />
            </Field>
            <Field label="Additional prohibited topics, one per line">
              <Textarea
                value={prohibitedTopics}
                onChange={(event) => setProhibitedTopics(event.target.value)}
                rows={4}
                disabled={!canManage}
              />
            </Field>
            <Field label="Escalation instructions">
              <Textarea
                value={escalation}
                onChange={(event) => setEscalation(event.target.value)}
                rows={4}
                disabled={!canManage}
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Required disclaimer language">
                <Textarea
                  value={disclaimer}
                  onChange={(event) => setDisclaimer(event.target.value)}
                  rows={3}
                  disabled={!canManage}
                />
              </Field>
            </div>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={saveKnowledge}
              >
                Save business information
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() =>
                  void action(
                    "approve-knowledge",
                    "/ai/knowledge/approve",
                    "POST",
                    undefined,
                    "Business information approved.",
                  )
                }
              >
                <ShieldCheck /> Approve business information
              </Button>
            </div>
          ) : null}
        </section>

        <section className="space-y-3 border-t pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-red-500/30 p-4">
            <div>
              <div className="font-medium">Emergency pause</div>
              <p className="text-sm text-muted-foreground">
                Immediately cancels queued AI replies without disabling the rest
                of RealtyTechAI.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Messaging readiness: SMS{" "}
                {configuration.readiness.communications.sms ? "ready" : "not ready"}
                {" · "}Email{" "}
                {configuration.readiness.communications.email
                  ? "ready"
                  : "not ready"}
                {" · "}Booking link{" "}
                {configuration.readiness.verifiedBookingLink
                  ? "verified"
                  : "not verified"}
              </p>
            </div>
            {canManage ? (
              <Button
                type="button"
                variant={
                  configuration.settings.aiPaused ? "outline" : "destructive"
                }
                disabled={Boolean(busy)}
                onClick={() =>
                  void action(
                    "pause",
                    "/ai/emergency-pause",
                    "POST",
                    {
                      paused: !configuration.settings.aiPaused,
                      reason: configuration.settings.aiPaused
                        ? ""
                        : "Workspace emergency pause activated by an administrator.",
                    },
                    configuration.settings.aiPaused
                      ? "Emergency pause cleared. Conversations remain paused until explicitly returned to AI."
                      : "AI activity paused immediately.",
                  )
                }
              >
                <PauseCircle />
                {configuration.settings.aiPaused
                  ? "Clear emergency pause"
                  : "Pause all AI"}
              </Button>
            ) : null}
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
