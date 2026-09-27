"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, ShieldCheck, XCircle, Eye } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

type ReadinessItem = {
  key: string
  passed: boolean
  verifiedAt?: string | null
  verifiedBy?: string | null
}

type TenantReadiness = {
  required: ReadinessItem[]
}

type ConsentEvidence = {
  exactConsentLanguage?: string
  consentCollectionMethod?: string
  sourceOwnership?: string
  optOutProcess?: string
  consentPolicyVersion?: string
  purchasedOrColdListsExcluded?: boolean
  clientResponsibilityAcknowledged?: boolean
  lawfulLeadCollectionCertified?: boolean
  termsAcceptedVersion?: string
  privacyAcceptedVersion?: string
  acceptableUseAcceptedVersion?: string
  dataRetentionAcceptedVersion?: string
}

type ReviewRecord = {
  verifiedAt?: string
  verifiedBy?: string
  verifiedByUserId?: string
  decision?: "approve" | "reject"
  scope?: string
  notes?: string | null
}

type OnboardingRecord = {
  tenantId: string
  consentConfiguration: ConsentEvidence
  consentPolicyAcknowledgedAt: string | null
  verifiedItems: Record<string, ReviewRecord>
}

type LoadState = "loading" | "ready" | "error"

const EVIDENCE_FIELDS: Array<{ key: keyof ConsentEvidence; label: string; boolean?: boolean }> = [
  { key: "exactConsentLanguage", label: "Exact consent language" },
  { key: "consentCollectionMethod", label: "Consent collection method" },
  { key: "sourceOwnership", label: "Lead source ownership" },
  { key: "optOutProcess", label: "Opt-out process" },
  { key: "consentPolicyVersion", label: "Consent policy version" },
  { key: "purchasedOrColdListsExcluded", label: "Purchased / cold lists excluded", boolean: true },
  { key: "clientResponsibilityAcknowledged", label: "Client responsibility acknowledged", boolean: true },
  { key: "lawfulLeadCollectionCertified", label: "Lawful lead collection certified", boolean: true },
  { key: "termsAcceptedVersion", label: "Terms accepted (version)" },
  { key: "privacyAcceptedVersion", label: "Privacy policy accepted (version)" },
  { key: "acceptableUseAcceptedVersion", label: "Acceptable use accepted (version)" },
  { key: "dataRetentionAcceptedVersion", label: "Data retention accepted (version)" },
]

export function ConsentAcknowledgmentCard({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<LoadState>("loading")
  const [record, setRecord] = useState<OnboardingRecord | null>(null)
  const [consentCheck, setConsentCheck] = useState<ReadinessItem | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const [readiness, onboarding] = await Promise.all([
          apiFetch<TenantReadiness>(`/admin/tenants/${tenantId}/readiness`),
          apiFetch<OnboardingRecord>(`/admin/tenants/${tenantId}/onboarding-record`),
        ])
        if (!active) return
        setConsentCheck(readiness.required.find((item) => item.key === "consent_policy") || null)
        setRecord(onboarding)
        setState("ready")
      } catch (cause) {
        if (!active) return
        setState("error")
        setMessage(cause instanceof Error ? cause.message : "Consent evidence could not be loaded")
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [tenantId])

  async function submitReview(decision: "approve" | "reject") {
    if (busy) return
    if (decision === "reject" && !notes.trim()) {
      setMessage("A rejection reason is required so the client knows what to fix.")
      return
    }
    setBusy(true)
    setMessage("")

    try {
      await apiFetch(`/admin/tenants/${tenantId}/consent-review`, {
        method: "POST",
        body: { decision, notes: notes.trim() || undefined },
      })
      setMessage(
        decision === "approve"
          ? "Consent evidence approved and recorded. Refreshing the checklist…"
          : "Consent evidence rejected. The client will see the reason. Refreshing…",
      )
      setReviewing(false)
      setNotes("")
      window.setTimeout(() => window.location.reload(), 900)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Consent review could not be recorded")
    } finally {
      setBusy(false)
    }
  }

  if (state === "loading") return null
  if (state === "error") {
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <XCircle className="h-4 w-4" />
            {message || "Consent evidence could not be loaded."}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Hide when the gate already passes and there is nothing to review.
  if (consentCheck?.passed && !reviewing) return null

  const evidence = record?.consentConfiguration || {}
  const review = record?.verifiedItems?.consent_policy
  const acknowledgedAt = record?.consentPolicyAcknowledgedAt

  function renderEvidenceValue(field: (typeof EVIDENCE_FIELDS)[number]) {
    const value = evidence[field.key]
    if (field.boolean) {
      return value === true ? (
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <CheckCircle2 className="h-4 w-4" /> Yes
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-destructive">
          <XCircle className="h-4 w-4" /> Not confirmed
        </span>
      )
    }
    const text = String(value || "").trim()
    return text ? (
      <span className="whitespace-pre-wrap">{text}</span>
    ) : (
      <span className="text-muted-foreground italic">Not provided</span>
    )
  }

  return (
    <Card className="border-amber-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Consent evidence review
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Review the client-provided consent and disclosure evidence, then approve or reject it.
          Approval records your identity and timestamp against the readiness gate. Rejection requires a reason
          so the client knows what to fix.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {review ? (
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">Last review</div>
            <div className="mt-1 space-y-1 text-muted-foreground">
              <div>
                Decision:{" "}
                <span className={review.decision === "approve" ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>
                  {review.decision === "approve" ? "Approved" : "Rejected"}
                </span>
              </div>
              {review.verifiedBy ? <div>Reviewer: {review.verifiedBy}</div> : null}
              {review.verifiedAt ? <div>Reviewed at: {new Date(review.verifiedAt).toLocaleString()}</div> : null}
              {review.scope ? <div>Scope: {review.scope === "tenant-wide" ? "Tenant-wide (all approved messaging channels)" : review.scope}</div> : null}
              {review.notes ? <div>Notes: {review.notes}</div> : null}
            </div>
          </div>
        ) : null}

        {acknowledgedAt ? (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            Acknowledged at {new Date(acknowledgedAt).toLocaleString()}
          </div>
        ) : null}

        {!reviewing ? (
          <Button onClick={() => setReviewing(true)} variant="outline">
            <Eye className="mr-2 h-4 w-4" />
            Review consent evidence
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border divide-y">
              {EVIDENCE_FIELDS.map((field) => (
                <div key={field.key} className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-3 sm:gap-4">
                  <div className="text-sm font-medium">{field.label}</div>
                  <div className="text-sm sm:col-span-2">{renderEvidenceValue(field)}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="consent-review-notes">
                Review notes (required to reject, optional to approve)
              </Label>
              <Textarea
                id="consent-review-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What did you verify? If rejecting, explain exactly what the client must fix."
                rows={3}
              />
            </div>

            {message ? (
              <div className="text-sm text-muted-foreground" role="status">
                {message}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void submitReview("approve")}>
                {busy ? "Recording…" : "Approve"}
              </Button>
              <Button disabled={busy} variant="destructive" onClick={() => void submitReview("reject")}>
                {busy ? "Recording…" : "Reject"}
              </Button>
              <Button disabled={busy} variant="ghost" onClick={() => { setReviewing(false); setNotes(""); setMessage("") }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {message && !reviewing ? (
          <div className="text-sm text-muted-foreground" role="status">
            {message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
