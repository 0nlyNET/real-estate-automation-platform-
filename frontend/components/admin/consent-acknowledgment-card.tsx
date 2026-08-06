"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, ShieldCheck } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

type ReadinessItem = {
  key: string
  passed: boolean
}

type TenantReadiness = {
  required: ReadinessItem[]
}

type LoadState = "loading" | "required" | "complete" | "error"

export function ConsentAcknowledgmentCard({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<LoadState>("loading")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let active = true

    void apiFetch<TenantReadiness>(`/admin/tenants/${tenantId}/readiness`)
      .then((readiness) => {
        if (!active) return
        const consent = readiness.required.find((item) => item.key === "consent_policy")
        setState(!consent || consent.passed ? "complete" : "required")
      })
      .catch((cause) => {
        if (!active) return
        setState("error")
        setMessage(cause instanceof Error ? cause.message : "Consent readiness could not be loaded")
      })

    return () => {
      active = false
    }
  }, [tenantId])

  async function recordAcknowledgment() {
    if (!confirmed || busy) return
    setBusy(true)
    setMessage("")

    try {
      await apiFetch(`/admin/tenants/${tenantId}/onboarding-evidence`, {
        method: "POST",
        body: { consentPolicyAcknowledgedAt: new Date().toISOString() },
      })
      setState("complete")
      setMessage("Consent acknowledgment recorded. Refreshing the checklist…")
      window.setTimeout(() => window.location.reload(), 700)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Consent acknowledgment could not be recorded")
    } finally {
      setBusy(false)
    }
  }

  if (state === "loading" || state === "complete") return null

  return (
    <Card className={state === "error" ? "border-destructive/40" : "border-amber-500/40"}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Record consent acknowledgment
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          This operator action confirms that the client-provided disclosure text, consent collection method, lead-source
          ownership, opt-out process, and cold-list exclusions were reviewed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === "required" ? (
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="consent-evidence-reviewed"
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <Label htmlFor="consent-evidence-reviewed" className="cursor-pointer text-sm leading-5">
              I reviewed the client-provided consent and disclosure evidence and confirm that it is accurately recorded
              in this workspace.
            </Label>
          </div>
        ) : null}

        {message ? (
          <div
            className={state === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
            role={state === "error" ? "alert" : "status"}
          >
            {message}
          </div>
        ) : null}

        {state === "required" ? (
          <Button disabled={!confirmed || busy} onClick={() => void recordAcknowledgment()}>
            {busy ? "Recording…" : "Record consent acknowledgment"}
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <CheckCircle2 className="h-4 w-4" />
            Reload the page and try again, or review the admin API connection.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
