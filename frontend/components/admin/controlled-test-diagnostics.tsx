"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Diagnostics = {
  testRunId: string | null
  status: string | null
  leadId: string | null
  aiRun: { id: string | null; status: string | null; errorCode: string | null; errorMessage: string | null } | null
  messages: Array<{
    id: string
    channel: string
    status: string
    errorCode: string | null
    blockedReason: string | null
    safetyRuleIds: string[]
    sanitizedErrorMessage: string | null
  }>
}

export function ControlledTestDiagnostics({ tenantId, onOpenConversation }: {
  tenantId: string
  onOpenConversation: (leadId: string) => void
}) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const version = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++version.current
    setBusy(true)
    try {
      const result = await apiFetch<Diagnostics>(`/admin/tenants/${tenantId}/testing/diagnostics`)
      if (request !== version.current) return
      setDiagnostics(result)
      setError("")
    } catch (cause) {
      if (request !== version.current) return
      setDiagnostics(null)
      setError(cause instanceof Error ? cause.message : "Test status could not be loaded.")
    } finally {
      if (request === version.current) setBusy(false)
    }
  }, [tenantId])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => { window.clearTimeout(timer); version.current += 1 }
  }, [refresh])

  return (
    <Card role="region" aria-label="Controlled test status">
      <CardHeader>
        <CardTitle>Controlled test status</CardTitle>
        <p className="text-sm text-muted-foreground">Inspect the active test run and delivery results. Test messages stay outside normal client reporting.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing test status…" : "Refresh test status"}</Button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {!error && diagnostics && !diagnostics.testRunId ? <p className="text-sm text-muted-foreground">No active controlled test run.</p> : null}
        {diagnostics?.testRunId ? (
          <div className="space-y-3 text-sm">
            <p className="break-all">Run: {diagnostics.testRunId} · {diagnostics.status}</p>
            {diagnostics.leadId ? <><p className="break-all">Lead: {diagnostics.leadId}</p><Button size="sm" variant="outline" onClick={() => onOpenConversation(diagnostics.leadId!)}>Open test conversation</Button></> : null}
            {diagnostics.aiRun ? <div className="rounded-md border p-3"><p className="break-all">AI run: {diagnostics.aiRun.id} · {diagnostics.aiRun.status}</p>{diagnostics.aiRun.errorCode ? <p>{diagnostics.aiRun.errorCode}</p> : null}{diagnostics.aiRun.errorMessage ? <p className="break-words">{diagnostics.aiRun.errorMessage}</p> : null}</div> : <p>No AI run was queued for this test lead.</p>}
            {diagnostics.messages.map((message) => <div key={message.id} className="rounded-md border p-3"><p className="break-all">{message.channel} · {message.status} · {message.id}</p>{message.errorCode ? <p>{message.errorCode}</p> : null}{message.blockedReason ? <p className="break-words">{message.blockedReason}</p> : null}{message.sanitizedErrorMessage ? <p className="break-words">{message.sanitizedErrorMessage}</p> : null}{message.safetyRuleIds?.length ? <p className="break-words">Safety checks: {message.safetyRuleIds.join(", ")}</p> : null}</div>)}
            {!diagnostics.messages.length ? <p>No outbound message has been created for this test lead.</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
