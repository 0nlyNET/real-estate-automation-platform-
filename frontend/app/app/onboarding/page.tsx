"use client"

import Link from "next/link"
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Plug, Save } from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Section = Record<string, unknown>
type RecordData = {
  businessIdentity: Section
  contacts: Section
  serviceScope: Section
  leadHandling: Section
  brandCommunication: Section
  consentConfiguration: Section
  integrationConfiguration: Section
  smsEnabled: boolean
  emailEnabled: boolean
  bookingEnabled: boolean
  targetLaunchDate?: string | null
}
type ReadinessItem = {
  key: string
  label: string
  passed: boolean
  responsibleParty: "client" | "jayden" | "provider" | "platform"
  statusMessage: string
  nextAction?: string | null
}
type Readiness = { ready: boolean; state: string; activationStatus: string; blockers: ReadinessItem[]; required: ReadinessItem[] }
type Settings = { timeZone: string; quietHoursStart: string; quietHoursEnd: string; bookingLink?: string }

const empty: RecordData = {
  businessIdentity: {}, contacts: {}, serviceScope: {}, leadHandling: {},
  brandCommunication: {}, consentConfiguration: {}, integrationConfiguration: {},
  smsEnabled: false, emailEnabled: false, bookingEnabled: false,
}

const steps = [
  { title: "Your business", description: "Who you are and who we contact" },
  { title: "Your leads", description: "Where leads come from and who handles them" },
  { title: "Communication", description: "Your voice, channels, and consent rules" },
  { title: "Review & connect", description: "Connect accounts and prepare for launch" },
]

function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string
  value: unknown
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={String(value || "")} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  )
}

function Choice({ label, checked, onChange, description }: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  description?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <span><span className="block text-sm font-medium">{label}</span>{description ? <span className="mt-1 block text-xs text-muted-foreground">{description}</span> : null}</span>
    </label>
  )
}

export default function OnboardingPage() {
  const [data, setData] = useState<RecordData>(empty)
  const [settings, setSettings] = useState<Settings>({ timeZone: "America/New_York", quietHoursStart: "21:00", quietHoursEnd: "08:00", bookingLink: "" })
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  const load = useCallback(async () => {
    const [record, currentSettings, currentReadiness] = await Promise.all([
      apiFetch<RecordData>("/onboarding"),
      apiFetch<Settings>("/settings/tenant"),
      apiFetch<Readiness>("/onboarding/readiness"),
    ])
    setData(record)
    setSettings(currentSettings)
    setReadiness(currentReadiness)
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load().catch((cause) => setMessage(cause instanceof Error ? cause.message : "Setup could not be loaded"))
    }, 0)
    return () => window.clearTimeout(initialLoad)
  }, [load])

  function field(section: keyof Pick<RecordData, "businessIdentity" | "contacts" | "serviceScope" | "leadHandling" | "brandCommunication" | "consentConfiguration" | "integrationConfiguration">, key: string, value: unknown) {
    setData((current) => ({ ...current, [section]: { ...current[section], [key]: value } }))
  }

  function csv(section: "businessIdentity" | "serviceScope", key: string, value: string) {
    field(section, key, value.split(",").map((item) => item.trim()).filter(Boolean))
  }

  function listValue(section: "businessIdentity" | "serviceScope", key: string) {
    const value = data[section]?.[key]
    return Array.isArray(value) ? value.join(", ") : String(value || "")
  }

  const completedClientSections = useMemo(() => {
    const smsBusinessReady = !data.smsEnabled || Boolean(
      data.businessIdentity.businessType && data.businessIdentity.companyType &&
      data.businessIdentity.ein && data.businessIdentity.website &&
      data.businessIdentity.businessAddress && data.businessIdentity.city &&
      data.businessIdentity.region && data.businessIdentity.postalCode &&
      data.contacts.firstName && data.contacts.lastName && data.contacts.email &&
      data.contacts.phone && data.contacts.jobPosition,
    )
    const smsCampaignReady = !data.smsEnabled || Boolean(
      data.consentConfiguration.campaignDescription && data.consentConfiguration.messageFlow &&
      data.consentConfiguration.sampleMessage && data.consentConfiguration.sampleMessage2 &&
      data.consentConfiguration.termsUrl && data.consentConfiguration.privacyUrl,
    )
    return [
      Boolean(data.businessIdentity.legalBusinessName && data.businessIdentity.primaryMarket && data.contacts.accountOwner && smsBusinessReady),
      Boolean(data.serviceScope.leadSources && data.leadHandling.routingRules && data.leadHandling.businessHours),
      Boolean(data.brandCommunication.brandName && data.brandCommunication.brandVoice && data.consentConfiguration.exactConsentLanguage && smsCampaignReady),
      Boolean(data.targetLaunchDate),
    ]
  }, [data])

  async function save(event?: FormEvent) {
    event?.preventDefault()
    setSaving(true)
    setMessage("")
    const accountOwner = String(data.contacts.accountOwner || "").trim()
    const normalized: RecordData = {
      ...data,
      contacts: {
        ...data.contacts,
        billingContact: data.contacts.billingContact || accountOwner,
        operationsContact: data.contacts.operationsContact || accountOwner,
        supportContact: data.contacts.supportContact || accountOwner,
        approvalContact: data.contacts.approvalContact || accountOwner,
        escalationContact: data.contacts.escalationContact || accountOwner,
      },
      serviceScope: {
        ...data.serviceScope,
        selectedPackage: "RealtyTechAI managed service",
        reportingFrequency: data.serviceScope.reportingFrequency || "weekly",
        includedChannels: [data.smsEnabled ? "sms" : null, data.emailEnabled ? "email" : null].filter(Boolean),
      },
      consentConfiguration: {
        ...data.consentConfiguration,
        consentPolicyVersion: data.consentConfiguration.consentPolicyVersion || "client-onboarding-v1",
      },
      integrationConfiguration: {
        ...data.integrationConfiguration,
        providerAccountOwner: "RealtyTechAI managed platform",
        authorizationStatus: data.integrationConfiguration.authorizationStatus || "client authorized setup",
      },
    }
    try {
      await apiFetch("/onboarding", { method: "PUT", body: normalized })
      await apiFetch("/settings/tenant", { method: "PUT", body: settings })
      setData(normalized)
      await load()
      setMessage("Saved. Your RealtyTechAI setup team can see these updates.")
      return true
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Save failed")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function continueForward() {
    if (await save()) setStep((current) => Math.min(current + 1, steps.length - 1))
  }

  return (
    <PageShell title="Get started" subtitle="Four short steps. Save as you go—RealtyTechAI handles the technical review and launch.">
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-2">
          {steps.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => setStep(index)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${step === index ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
            >
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${completedClientSections[index] ? "bg-emerald-500 text-white" : step === index ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {completedClientSections[index] ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span><span className="block text-sm font-medium">{item.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span></span>
            </button>
          ))}
          <Card className="mt-4">
            <CardContent className="p-4 text-sm">
              <div className="font-medium">Overall status</div>
              <div className="mt-1 text-muted-foreground">{readiness?.ready ? "Ready for final activation" : readiness?.activationStatus?.replaceAll("_", " ") || "Loading…"}</div>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                {readiness?.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4" />}
                {readiness?.blockers?.length || 0} setup checks remaining
              </div>
            </CardContent>
          </Card>
        </aside>

        <form onSubmit={save}>
          <Card>
            <CardHeader>
              <div className="text-xs font-medium uppercase tracking-wide text-primary">Step {step + 1} of {steps.length}</div>
              <CardTitle>{steps[step].title}</CardTitle>
              <p className="text-sm text-muted-foreground">{steps[step].description}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              {step === 0 ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Legal business name" value={data.businessIdentity.legalBusinessName} onChange={(value) => field("businessIdentity", "legalBusinessName", value)} placeholder="Lakeview Realty LLC" />
                    <Field label="Name clients know you by" value={data.businessIdentity.publicBusinessName} onChange={(value) => field("businessIdentity", "publicBusinessName", value)} placeholder="Lakeview Realty Group" />
                    <Field label="Brokerage" value={data.businessIdentity.brokerage} onChange={(value) => field("businessIdentity", "brokerage", value)} />
                    <Field label="Primary market" value={data.businessIdentity.primaryMarket} onChange={(value) => field("businessIdentity", "primaryMarket", value)} placeholder="Buffalo, NY" />
                    <Field label="Website" type="url" value={data.businessIdentity.website} onChange={(value) => field("businessIdentity", "website", value)} />
                    <Field label="Areas you serve (comma-separated)" value={listValue("businessIdentity", "serviceAreas")} onChange={(value) => csv("businessIdentity", "serviceAreas", value)} />
                    <Field label="Best account-owner email" type="email" value={data.contacts.accountOwner} onChange={(value) => field("contacts", "accountOwner", value)} />
                    <Field label="Controlled SMS test phone" value={data.contacts.controlledTestPhone} onChange={(value) => field("contacts", "controlledTestPhone", value)} />
                    <Field label="Controlled email test recipient" type="email" value={data.contacts.controlledTestEmail || data.contacts.accountOwner} onChange={(value) => field("contacts", "controlledTestEmail", value)} />
                    <Field label="Billing email (if different)" type="email" value={data.contacts.billingContact} onChange={(value) => field("contacts", "billingContact", value)} />
                    <Field label="Time zone" value={settings.timeZone} onChange={(value) => setSettings((current) => ({ ...current, timeZone: value }))} />
                  </div>
                  {data.smsEnabled ? (
                    <div className="space-y-4 rounded-lg border p-4">
                      <div><div className="font-medium">Twilio business verification</div><p className="text-sm text-muted-foreground">Required only for SMS registration. Enter the legal information exactly as registered with the IRS.</p></div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Legal business type" value={data.businessIdentity.businessType} onChange={(value) => field("businessIdentity", "businessType", value)} placeholder="LLC, Corporation, Partnership" />
                        <Field label="EIN" value={data.businessIdentity.ein} onChange={(value) => field("businessIdentity", "ein", value)} placeholder="12-3456789" />
                        <Field label="Company type" value={data.businessIdentity.companyType} onChange={(value) => field("businessIdentity", "companyType", value)} placeholder="private, public, non-profit, or government" />
                        <Field label="Street address" value={data.businessIdentity.businessAddress} onChange={(value) => field("businessIdentity", "businessAddress", value)} />
                        <Field label="City" value={data.businessIdentity.city} onChange={(value) => field("businessIdentity", "city", value)} />
                        <Field label="State / region" value={data.businessIdentity.region} onChange={(value) => field("businessIdentity", "region", value)} placeholder="NY" />
                        <Field label="Postal code" value={data.businessIdentity.postalCode} onChange={(value) => field("businessIdentity", "postalCode", value)} />
                        <Field label="Country code" value={data.businessIdentity.country || "US"} onChange={(value) => field("businessIdentity", "country", value)} placeholder="US" />
                        {String(data.businessIdentity.companyType || "").toLowerCase() === "public" ? <><Field label="Stock exchange" value={data.businessIdentity.stockExchange} onChange={(value) => field("businessIdentity", "stockExchange", value)} /><Field label="Stock ticker" value={data.businessIdentity.stockTicker} onChange={(value) => field("businessIdentity", "stockTicker", value)} /><Field label="Brand contact email" type="email" value={data.businessIdentity.brandContactEmail} onChange={(value) => field("businessIdentity", "brandContactEmail", value)} /></> : null}
                        <Field label="Representative first name" value={data.contacts.firstName} onChange={(value) => field("contacts", "firstName", value)} />
                        <Field label="Representative last name" value={data.contacts.lastName} onChange={(value) => field("contacts", "lastName", value)} />
                        <Field label="Representative business email" type="email" value={data.contacts.email || data.contacts.accountOwner} onChange={(value) => field("contacts", "email", value)} />
                        <Field label="Representative phone" value={data.contacts.phone} onChange={(value) => field("contacts", "phone", value)} />
                        <Field label="Representative position" value={data.contacts.jobPosition} onChange={(value) => field("contacts", "jobPosition", value)} placeholder="Owner, CEO, Director, VP" />
                        <Field label="Representative title" value={data.contacts.businessTitle} onChange={(value) => field("contacts", "businessTitle", value)} placeholder="Broker Owner" />
                      </div>
                    </div>
                  ) : null}
                  <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">We use the account owner as the setup, support, approval, and escalation contact unless you tell us otherwise later.</p>
                </>
              ) : null}

              {step === 1 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Where leads come from (comma-separated)" value={listValue("serviceScope", "leadSources")} onChange={(value) => csv("serviceScope", "leadSources", value)} placeholder="Website, Facebook Lead Ads, Realtor.com" />
                  <Field label="Expected leads per month" type="number" value={data.serviceScope.expectedLeadVolume} onChange={(value) => field("serviceScope", "expectedLeadVolume", value)} />
                  <Field label="Who should receive new leads?" value={data.leadHandling.routingRules} onChange={(value) => field("leadHandling", "routingRules", value)} placeholder="Round robin between Alex and Jordan" />
                  <Field label="Business hours" value={data.leadHandling.businessHours} onChange={(value) => field("leadHandling", "businessHours", value)} placeholder="Mon–Fri 8 AM–7 PM" />
                  <Field label="When should a lead be escalated?" value={data.leadHandling.escalationBehavior} onChange={(value) => field("leadHandling", "escalationBehavior", value)} placeholder="Notify owner after 15 minutes without a response" />
                  <Field label="Preferred follow-up timing" value={data.leadHandling.followUpTiming} onChange={(value) => field("leadHandling", "followUpTiming", value)} placeholder="Immediately, then next morning" />
                  <Field label="Quiet hours start" type="time" value={settings.quietHoursStart} onChange={(value) => setSettings((current) => ({ ...current, quietHoursStart: value }))} />
                  <Field label="Quiet hours end" type="time" value={settings.quietHoursEnd} onChange={(value) => setSettings((current) => ({ ...current, quietHoursEnd: value }))} />
                </div>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Choice label="Text messages" checked={data.smsEnabled} onChange={(value) => setData((current) => ({ ...current, smsEnabled: value }))} description="RealtyTechAI manages delivery using your approved brokerage identity" />
                    <Choice label="Email" checked={data.emailEnabled} onChange={(value) => setData((current) => ({ ...current, emailEnabled: value }))} description="Uses the sending account you connect" />
                    <Choice label="Appointment booking" checked={data.bookingEnabled} onChange={(value) => setData((current) => ({ ...current, bookingEnabled: value }))} description="Sends leads to your calendar link" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Brand or team name" value={data.brandCommunication.brandName} onChange={(value) => field("brandCommunication", "brandName", value)} />
                    <Field label="How should messages sound?" value={data.brandCommunication.brandVoice} onChange={(value) => field("brandCommunication", "brandVoice", value)} placeholder="Warm, concise, helpful" />
                    <Field label="Message signature" value={data.brandCommunication.requiredSignature} onChange={(value) => field("brandCommunication", "requiredSignature", value)} placeholder="— Alex at Lakeview Realty" />
                    {data.smsEnabled ? <Field label="Approved texting number or identity" value={data.brandCommunication.approvedPhoneIdentity} onChange={(value) => field("brandCommunication", "approvedPhoneIdentity", value)} /> : null}
                    {data.emailEnabled ? <Field label="Approved sender email" type="email" value={data.brandCommunication.approvedEmailIdentity} onChange={(value) => field("brandCommunication", "approvedEmailIdentity", value)} /> : null}
                    {data.bookingEnabled ? <Field label="Booking link" type="url" value={settings.bookingLink} onChange={(value) => setSettings((current) => ({ ...current, bookingLink: value }))} /> : null}
                    <Field label="How do people agree to be contacted?" value={data.consentConfiguration.consentCollectionMethod} onChange={(value) => field("consentConfiguration", "consentCollectionMethod", value)} placeholder="Checkbox on our website lead form" />
                    <Field label="How do you handle opt-outs?" value={data.consentConfiguration.optOutProcess} onChange={(value) => field("consentConfiguration", "optOutProcess", value)} placeholder="Honor STOP and unsubscribe immediately" />
                  </div>
                  <div className="space-y-2"><Label htmlFor="consent-copy">Exact consent language shown on your lead form</Label><Textarea id="consent-copy" value={String(data.consentConfiguration.exactConsentLanguage || "")} onChange={(event) => field("consentConfiguration", "exactConsentLanguage", event.target.value)} /></div>
                  {data.smsEnabled ? (
                    <div className="space-y-4 rounded-lg border p-4">
                      <div><div className="font-medium">A2P campaign registration</div><p className="text-sm text-muted-foreground">These exact examples and public URLs are submitted to Twilio for carrier review.</p></div>
                      <div className="space-y-2"><Label htmlFor="campaign-description">Campaign description (40–4096 characters)</Label><Textarea id="campaign-description" value={String(data.consentConfiguration.campaignDescription || "")} onChange={(event) => field("consentConfiguration", "campaignDescription", event.target.value)} /></div>
                      <div className="space-y-2"><Label htmlFor="message-flow">Detailed opt-in flow (40–2048 characters)</Label><Textarea id="message-flow" value={String(data.consentConfiguration.messageFlow || "")} onChange={(event) => field("consentConfiguration", "messageFlow", event.target.value)} /></div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Sample SMS 1" value={data.consentConfiguration.sampleMessage} onChange={(value) => field("consentConfiguration", "sampleMessage", value)} />
                        <Field label="Sample SMS 2" value={data.consentConfiguration.sampleMessage2} onChange={(value) => field("consentConfiguration", "sampleMessage2", value)} />
                        <Field label="Public terms URL" type="url" value={data.consentConfiguration.termsUrl} onChange={(value) => field("consentConfiguration", "termsUrl", value)} />
                        <Field label="Public privacy URL" type="url" value={data.consentConfiguration.privacyUrl} onChange={(value) => field("consentConfiguration", "privacyUrl", value)} />
                        <Field label="Opt-in reply (if using START)" value={data.consentConfiguration.optInMessage} onChange={(value) => field("consentConfiguration", "optInMessage", value)} />
                        <Field label="Opt-out reply (if self-managed)" value={data.consentConfiguration.optOutMessage} onChange={(value) => field("consentConfiguration", "optOutMessage", value)} />
                        <Field label="Help reply (if self-managed)" value={data.consentConfiguration.helpMessage} onChange={(value) => field("consentConfiguration", "helpMessage", value)} />
                        <Field label="A2P use case" value={data.consentConfiguration.a2pUseCase || "LOW_VOLUME"} onChange={(value) => field("consentConfiguration", "a2pUseCase", value)} />
                      </div>
                      <div className="grid gap-3 md:grid-cols-2"><Choice label="Messages may contain links" checked={data.consentConfiguration.hasEmbeddedLinks === true} onChange={(value) => field("consentConfiguration", "hasEmbeddedLinks", value)} /><Choice label="Messages may contain phone numbers" checked={data.consentConfiguration.hasEmbeddedPhone === true} onChange={(value) => field("consentConfiguration", "hasEmbeddedPhone", value)} /></div>
                    </div>
                  ) : null}
                  <div className="grid gap-3 md:grid-cols-2">
                    <Choice label="We use only leads we own or are authorized to contact" checked={data.consentConfiguration.sourceOwnership === "authorized"} onChange={(value) => field("consentConfiguration", "sourceOwnership", value ? "authorized" : "")} />
                    <Choice label="We will not upload purchased or cold lists" checked={data.consentConfiguration.purchasedOrColdListsExcluded === true} onChange={(value) => field("consentConfiguration", "purchasedOrColdListsExcluded", value)} />
                    <Choice label="We are responsible for keeping consent evidence" checked={data.consentConfiguration.clientResponsibilityAcknowledged === true} onChange={(value) => field("consentConfiguration", "clientResponsibilityAcknowledged", value)} />
                    <Choice label="Our message copy has had a fair-housing review" checked={data.brandCommunication.fairHousingReviewAcknowledged === true} onChange={(value) => field("brandCommunication", "fairHousingReviewAcknowledged", value)} />
                    <Choice label="We certify that every lead was collected lawfully for the intended communications" checked={data.consentConfiguration.lawfulLeadCollectionCertified === true} onChange={(value) => field("consentConfiguration", "lawfulLeadCollectionCertified", value)} />
                    <Choice label="We accept the current Terms of Service" checked={data.consentConfiguration.termsAcceptedVersion === "2026-08-11"} onChange={(value) => field("consentConfiguration", "termsAcceptedVersion", value ? "2026-08-11" : "")} />
                    <Choice label="We acknowledge the current Privacy Policy" checked={data.consentConfiguration.privacyAcceptedVersion === "2026-08-11"} onChange={(value) => field("consentConfiguration", "privacyAcceptedVersion", value ? "2026-08-11" : "")} />
                    <Choice label="We accept the Acceptable Use Policy" checked={data.consentConfiguration.acceptableUseAcceptedVersion === "2026-08-11"} onChange={(value) => field("consentConfiguration", "acceptableUseAcceptedVersion", value ? "2026-08-11" : "")} />
                    <Choice label="We acknowledge the Data Retention & Deletion Policy" checked={data.consentConfiguration.dataRetentionAcceptedVersion === "2026-08-11"} onChange={(value) => field("consentConfiguration", "dataRetentionAcceptedVersion", value ? "2026-08-11" : "")} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Review the <Link className="text-primary hover:underline" href="/terms">Terms</Link>,{" "}
                    <Link className="text-primary hover:underline" href="/privacy">Privacy Policy</Link>,{" "}
                    <Link className="text-primary hover:underline" href="/acceptable-use">Acceptable Use Policy</Link>, and{" "}
                    <Link className="text-primary hover:underline" href="/data-retention">Data Retention &amp; Deletion Policy</Link> before accepting.
                  </p>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Target launch date" type="date" value={data.targetLaunchDate} onChange={(value) => setData((current) => ({ ...current, targetLaunchDate: value || null }))} />
                  </div>
                  <Card className="border-primary/30 bg-primary/5">
                    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex gap-3"><Plug className="mt-0.5 h-5 w-5 text-primary" /><div><div className="font-medium">Connect your lead sources</div><p className="mt-1 text-sm text-muted-foreground">Connect your website form and supported lead sources. RealtyTechAI manages SMS and email delivery for you.</p></div></div>
                      <Button asChild type="button"><Link href="/app/integrations">Open connections</Link></Button>
                    </CardContent>
                  </Card>
                  <div className="rounded-lg border p-5">
                    <div className="font-medium">What happens after you finish</div>
                    <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
                      <li className="flex gap-3"><span className="font-semibold text-foreground">1.</span> RealtyTechAI reviews your information and connected accounts.</li>
                      <li className="flex gap-3"><span className="font-semibold text-foreground">2.</span> We run a controlled test lead, message delivery, opt-out, and booking test.</li>
                      <li className="flex gap-3"><span className="font-semibold text-foreground">3.</span> You approve the final setup in writing; we activate service only when every required check passes.</li>
                    </ol>
                  </div>
                  {readiness?.blockers?.length ? (
                    <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">See remaining review checks ({readiness.blockers.length})</summary><div className="mt-3 grid gap-2 md:grid-cols-2">{readiness.blockers.map((item) => <div key={item.key} className="flex gap-2 rounded-md border p-3 text-sm text-muted-foreground"><Circle className="mt-0.5 h-4 w-4 shrink-0" /><span><span className="block font-medium text-foreground">{item.label}</span><span className="mt-1 block text-xs">Owner: {item.responsibleParty === "client" ? "you" : item.responsibleParty === "provider" ? "external provider" : "RealtyTechAI"}</span>{item.nextAction ? <span className="mt-1 block text-xs">{item.nextAction}</span> : null}</span></div>)}</div></details>
                  ) : null}
                </>
              ) : null}

              {message ? <p className="rounded-md border p-3 text-sm">{message}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                <div className="flex gap-2">
                  <Button type="submit" variant="outline" disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save"}</Button>
                  {step < steps.length - 1 ? <Button type="button" disabled={saving} onClick={() => void continueForward()}>Save & continue <ArrowRight className="ml-2 h-4 w-4" /></Button> : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </PageShell>
  )
}
