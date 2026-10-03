"use client"

import { type FormEvent, useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Grant = {
  id: string
  tenantId: string
  recipientAllowlist: string[]
  expiresAt: string
  dailyLimit: number
  totalLimit: number
  isRevoked: boolean
}

export function OperatorEmailTest({ tenantId, tenantName, lifecycleStatus }: {
  tenantId: string
  tenantName: string
  lifecycleStatus: string
}) {
  const [grants, setGrants] = useState<Grant[]>([])
  const [recipient, setRecipient] = useState("")
  const [purpose, setPurpose] = useState("")
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const unavailable = ["SUSPENDED", "CANCELED"].includes(lifecycleStatus)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setGrants(await apiFetch<Grant[]>(`/admin/operator-test/grants/${encodeURIComponent(tenantId)}`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test grants could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    let current = true
    void apiFetch<Grant[]>(`/admin/operator-test/grants/${encodeURIComponent(tenantId)}`)
      .then((items) => { if (current) setGrants(items) })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : "Test grants could not be loaded.")
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [tenantId])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy || !consent || unavailable || loading || error) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const grant = await apiFetch<Grant>("/admin/operator-test/grants", {
        method: "POST",
        body: {
          tenantId,
          recipientAllowlist: [recipient.trim().toLowerCase()],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          dailyLimit: 5,
          totalLimit: 10,
          purpose: purpose.trim(),
        },
      })
      setGrants((current) => [grant, ...current])
      setConsent(false)
      setNotice("Email test grant created. Billing remains unchanged. Complete the normal controlled test in Setup.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test grant could not be created.")
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (busy) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await apiFetch(`/admin/operator-test/grants/${encodeURIComponent(id)}`, { method: "DELETE" })
      setGrants((current) => current.map((grant) => grant.id === id ? { ...grant, isRevoked: true } : grant))
      setNotice("Grant revoked. New and queued emails using this grant are blocked.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test grant could not be revoked.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="min-w-0 space-y-4 rounded-lg border bg-card p-5 break-words" aria-label="Operator email test">
      <h3 className="font-semibold">Operator email test</h3>
      <p className="text-sm text-muted-foreground">Authorize email testing for {tenantName} with one consenting recipient. Each grant lasts 24 hours and permits five emails per UTC day, ten total. Billing and client activation remain unchanged; consent, opt-out, pauses, and other safety checks still apply.</p>
      {error ? <div role="alert" className="text-sm text-destructive">{error} <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>Reload grants</Button></div> : null}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {loading ? <p role="status">Loading test grants…</p> : null}
      {grants.map((grant) => (
        <div key={grant.id} className="space-y-2 rounded-md border p-3 text-sm">
          <p>{grant.recipientAllowlist.join(", ")}</p>
          <p>Grant: {grant.id}</p>
          <p>{grant.isRevoked ? "Revoked" : "Not revoked (expiry enforced by server)"} · Expires {new Date(grant.expiresAt).toLocaleString()} · {grant.dailyLimit}/day · {grant.totalLimit} total</p>
          {!grant.isRevoked ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void revoke(grant.id)}>Revoke grant</Button> : null}
        </div>
      ))}
      {unavailable ? <p>This workspace is suspended or canceled. Email test grants cannot restore services.</p> : (
        <form className="grid min-w-0 gap-3" onSubmit={(event) => void create(event)}>
          <div className="space-y-1"><Label htmlFor="operator-test-recipient">Test recipient email</Label><Input id="operator-test-recipient" type="email" required value={recipient} onChange={(event) => setRecipient(event.target.value)} disabled={busy} /></div>
          <div className="space-y-1"><Label htmlFor="operator-test-purpose">Test purpose</Label><Input id="operator-test-purpose" required maxLength={500} value={purpose} onChange={(event) => setPurpose(event.target.value)} disabled={busy} /></div>
          <label className="flex min-w-0 items-start gap-2 text-sm"><input className="shrink-0" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} required /><span className="min-w-0">I confirm this recipient is owned or has explicitly consented to this email test for {tenantName}.</span></label>
          <Button className="relative min-h-11 h-auto w-full whitespace-normal py-2 sm:w-auto" type="submit" disabled={busy || loading || !consent || Boolean(error) || !recipient.trim() || !purpose.trim()}>Create 24-hour email test grant</Button>
        </form>
      )}
    </section>
  )
}
