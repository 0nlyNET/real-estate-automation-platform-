"use client"

import { FormEvent, useState } from "react"
import { Bot, CheckCircle2, ShieldAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api"

type AssistantRun = {
  id: string
  status: "completed" | "confirmation_required" | "blocked" | "failed"
  response: string
  results: Array<{ name: string; status: string }>
  confirmationRequired: Array<{ name: string; arguments: Record<string, unknown> }>
}

export default function OperationsAssistantPage() {
  const [prompt, setPrompt] = useState("")
  const [run, setRun] = useState<AssistantRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function request(path: string, body?: Record<string, unknown>) {
    setBusy(true)
    setError("")
    try {
      setRun(await apiFetch<AssistantRun>(path, { method: "POST", body }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operations AI request failed")
    } finally {
      setBusy(false)
    }
  }

  function ask(event: FormEvent) {
    event.preventDefault()
    if (prompt.trim()) void request("/admin/ai/operations-assistant", { prompt: prompt.trim() })
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">Operations AI</h1><p className="mt-1 text-sm text-muted-foreground">Diagnose exceptions and request bounded, auditable recovery actions.</p></div>
      <Alert><ShieldAlert /><AlertTitle>Safety boundary</AlertTitle><AlertDescription>This assistant cannot refund payments, change prices, delete tenants, release numbers, rotate parent credentials, override opt-outs, approve compliance, or disable global safeguards. Mutations require super-administrator confirmation.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Investigate an exception</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={ask} className="space-y-3"><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000} rows={6} placeholder="Summarize current exceptions and suggest the next safe recovery action." /><Button disabled={busy || !prompt.trim()}>{busy ? "Working…" : "Ask Operations AI"}</Button></form>
          {error ? <Alert variant="destructive"><AlertTitle>Request failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          {run ? <div className="space-y-3 rounded-lg border p-4"><p className="whitespace-pre-wrap text-sm">{run.response}</p>{run.results.map((result, index) => <div key={`${result.name}-${index}`} className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{result.name.replaceAll("_", " ")}</div>)}{run.confirmationRequired.length ? <Alert><ShieldAlert /><AlertTitle>Super-administrator confirmation required</AlertTitle><AlertDescription className="space-y-3"><p>{run.confirmationRequired.map((item) => item.name.replaceAll("_", " ")).join(", ")}</p><Button type="button" disabled={busy} onClick={() => void request(`/admin/ai/operations-assistant/${run.id}/confirm`)}>Confirm bounded recovery</Button></AlertDescription></Alert> : null}</div> : null}
        </CardContent>
      </Card>
    </div>
  )
}
