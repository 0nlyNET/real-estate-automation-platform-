"use client"

import { FormEvent, useEffect, useState } from "react"
import { CheckCircle2, Circle, Save } from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

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
type ReadinessItem = { key: string; label: string; passed: boolean; verifiedAt?: string | null; verifiedBy?: string | null }
type Readiness = { ready: boolean; state: string; blockers: ReadinessItem[]; required: ReadinessItem[]; optional: ReadinessItem[] }
type Settings = { timeZone: string; quietHoursStart: string; quietHoursEnd: string; bookingLink?: string }

const empty: RecordData = {
  businessIdentity: {}, contacts: {}, serviceScope: {}, leadHandling: {},
  brandCommunication: {}, consentConfiguration: {}, integrationConfiguration: {},
  smsEnabled: false, emailEnabled: false, bookingEnabled: false,
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: unknown; onChange: (value: string) => void; type?: string }) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={String(value || "")} onChange={(e) => onChange(e.target.value)} /></div>
}

function BoolField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} /><span>{label}</span></label>
}

export default function OnboardingPage() {
  const [data, setData] = useState<RecordData>(empty)
  const [settings, setSettings] = useState<Settings>({ timeZone: "America/New_York", quietHoursStart: "21:00", quietHoursEnd: "08:00", bookingLink: "" })
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  async function load() {
    const [record, currentSettings, currentReadiness] = await Promise.all([
      apiFetch<RecordData>("/onboarding"), apiFetch<Settings>("/settings/tenant"), apiFetch<Readiness>("/onboarding/readiness"),
    ])
    setData(record)
    setSettings(currentSettings)
    setReadiness(currentReadiness)
  }
  useEffect(() => { void load().catch((cause) => setMessage(cause instanceof Error ? cause.message : "Setup could not be loaded")) }, [])

  function field(section: keyof Pick<RecordData, "businessIdentity" | "contacts" | "serviceScope" | "leadHandling" | "brandCommunication" | "consentConfiguration" | "integrationConfiguration">, key: string, value: unknown) {
    setData((current) => ({ ...current, [section]: { ...current[section], [key]: value } }))
  }
  function csv(section: "businessIdentity" | "serviceScope" | "leadHandling" | "brandCommunication", key: string, value: string) {
    field(section, key, value.split(",").map((item) => item.trim()).filter(Boolean))
  }
  function listValue(section: keyof RecordData, key: string) {
    const value = (data[section] as Section)?.[key]
    return Array.isArray(value) ? value.join(", ") : String(value || "")
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("")
    try {
      await apiFetch("/onboarding", { method: "PUT", body: data })
      await apiFetch("/settings/tenant", { method: "PUT", body: settings })
      await load(); setMessage("Setup information saved. Technical tests and launch approvals still require operator evidence.")
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Save failed") }
    finally { setSaving(false) }
  }

  return (
    <PageShell title="Setup & readiness" subtitle="Complete client intake, then work with the launch operator to verify providers and UAT evidence.">
      <form className="space-y-6" onSubmit={save}>
        <Card><CardHeader><CardTitle>Readiness evidence</CardTitle></CardHeader><CardContent className="space-y-3">
          <div className="flex items-center gap-2"><Badge variant={readiness?.ready ? "default" : "secondary"}>{readiness?.ready ? "Ready for operator activation" : readiness?.state || "Loading"}</Badge><span className="text-sm text-muted-foreground">Clients cannot self-activate technical services.</span></div>
          <div className="grid gap-2 md:grid-cols-2">{readiness?.required.map((item) => <div key={item.key} className="flex gap-2 rounded border p-3 text-sm">{item.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}<div><div>{item.label}</div>{item.verifiedAt ? <div className="text-xs text-muted-foreground">Verified {new Date(item.verifiedAt).toLocaleString()}</div> : null}</div></div>)}</div>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Business information</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          {[["Legal business name","legalBusinessName"],["Public business or team name","publicBusinessName"],["Brokerage","brokerage"],["Website","website"],["Business address","businessAddress"],["Primary market","primaryMarket"],["License information (optional)","licenseInformation"]].map(([label,key]) => <Field key={key} label={label} value={data.businessIdentity[key]} onChange={(v) => field("businessIdentity", key, v)} />)}
          <Field label="Service areas (comma-separated)" value={listValue("businessIdentity", "serviceAreas")} onChange={(v) => csv("businessIdentity", "serviceAreas", v)} />
          <Field label="Time zone" value={settings.timeZone} onChange={(v) => setSettings((s) => ({ ...s, timeZone: v }))} />
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Contacts</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          {[["Account owner","accountOwner"],["Billing contact","billingContact"],["Operations contact","operationsContact"],["Support contact","supportContact"],["Approval contact","approvalContact"],["Escalation contact","escalationContact"]].map(([label,key]) => <Field key={key} label={label} value={data.contacts[key]} onChange={(v) => field("contacts", key, v)} />)}
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Service scope</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Selected package" value={data.serviceScope.selectedPackage} onChange={(v) => field("serviceScope", "selectedPackage", v)} />
          <Field label="Lead sources (comma-separated)" value={listValue("serviceScope", "leadSources")} onChange={(v) => csv("serviceScope", "leadSources", v)} />
          <Field label="Expected monthly lead volume" value={data.serviceScope.expectedLeadVolume} onChange={(v) => field("serviceScope", "expectedLeadVolume", v)} />
          <Field label="Support expectations" value={data.serviceScope.supportExpectations} onChange={(v) => field("serviceScope", "supportExpectations", v)} />
          <Field label="Reporting frequency" value={data.serviceScope.reportingFrequency} onChange={(v) => field("serviceScope", "reportingFrequency", v)} />
          <Field label="Agreed manual service" value={data.serviceScope.manualService} onChange={(v) => field("serviceScope", "manualService", v)} />
          <div className="space-y-2 md:col-span-2"><Label>Included channels</Label><div className="grid gap-2 sm:grid-cols-3"><BoolField label="SMS" checked={data.smsEnabled} onChange={(v) => { setData((d) => ({ ...d, smsEnabled: v, serviceScope: { ...d.serviceScope, includedChannels: [v ? "sms" : null, d.emailEnabled ? "email" : null].filter(Boolean) } })) }} /><BoolField label="Email" checked={data.emailEnabled} onChange={(v) => { setData((d) => ({ ...d, emailEnabled: v, serviceScope: { ...d.serviceScope, includedChannels: [d.smsEnabled ? "sms" : null, v ? "email" : null].filter(Boolean) } })) }} /><BoolField label="Booking" checked={data.bookingEnabled} onChange={(v) => setData((d) => ({ ...d, bookingEnabled: v }))} /></div></div>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Lead handling</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          {[["Form or campaign identifiers","campaignIdentifiers"],["Routing rules","routingRules"],["Team assignments","teamAssignments"],["Business hours","businessHours"],["Escalation behavior","escalationBehavior"],["Response copy notes","responseCopy"],["Follow-up timing","followUpTiming"]].map(([label,key]) => <Field key={key} label={label} value={data.leadHandling[key]} onChange={(v) => field("leadHandling", key, v)} />)}
          <Field label="Quiet hours start" type="time" value={settings.quietHoursStart} onChange={(v) => setSettings((s) => ({ ...s, quietHoursStart: v }))} /><Field label="Quiet hours end" type="time" value={settings.quietHoursEnd} onChange={(v) => setSettings((s) => ({ ...s, quietHoursEnd: v }))} />
          <Field label="Booking link" type="url" value={settings.bookingLink} onChange={(v) => setSettings((s) => ({ ...s, bookingLink: v }))} />
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Brand and communication</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          {[["Brand or team name","brandName"],["Brand voice","brandVoice"],["Required signature","requiredSignature"],["Approved phone identity","approvedPhoneIdentity"],["Approved email identity","approvedEmailIdentity"],["Required links","requiredLinks"],["Prohibited language","prohibitedLanguage"]].map(([label,key]) => <Field key={key} label={label} value={data.brandCommunication[key]} onChange={(v) => field("brandCommunication", key, v)} />)}
          <BoolField label="Fair-housing review acknowledged" checked={data.brandCommunication.fairHousingReviewAcknowledged === true} onChange={(v) => field("brandCommunication", "fairHousingReviewAcknowledged", v)} />
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Consent policy</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          {[["How consent is collected","consentCollectionMethod"],["Source ownership","sourceOwnership"],["Opt-out process","optOutProcess"],["Consent-policy version","consentPolicyVersion"]].map(([label,key]) => <Field key={key} label={label} value={data.consentConfiguration[key]} onChange={(v) => field("consentConfiguration", key, v)} />)}
          <div className="space-y-2 md:col-span-2"><Label htmlFor="consent-language">Exact consent language or disclosure</Label><Textarea id="consent-language" value={String(data.consentConfiguration.exactConsentLanguage || "")} onChange={(e) => field("consentConfiguration", "exactConsentLanguage", e.target.value)} /></div>
          <BoolField label="Purchased or cold lists are excluded" checked={data.consentConfiguration.purchasedOrColdListsExcluded === true} onChange={(v) => field("consentConfiguration", "purchasedOrColdListsExcluded", v)} />
          <BoolField label="Client responsibility for consent evidence is acknowledged" checked={data.consentConfiguration.clientResponsibilityAcknowledged === true} onChange={(v) => field("consentConfiguration", "clientResponsibilityAcknowledged", v)} />
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Integrations and launch</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Provider account owner" value={data.integrationConfiguration.providerAccountOwner} onChange={(v) => field("integrationConfiguration", "providerAccountOwner", v)} />
          <Field label="Authorization status" value={data.integrationConfiguration.authorizationStatus} onChange={(v) => field("integrationConfiguration", "authorizationStatus", v)} />
          <Field label="Target launch date" type="date" value={data.targetLaunchDate} onChange={(v) => setData((d) => ({ ...d, targetLaunchDate: v || null }))} />
          <p className="self-end rounded-md bg-muted p-3 text-sm text-muted-foreground">Provider tests, template approval, controlled lead evidence, client written approval, operator approval, and activation are recorded by the platform operator.</p>
        </CardContent></Card>

        {message ? <p className="rounded-md border p-3 text-sm">{message}</p> : null}
        <Button disabled={saving} size="lg"><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save setup information"}</Button>
      </form>
    </PageShell>
  )
}
