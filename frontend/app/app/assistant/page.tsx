"use client"

import { FormEvent, useState } from "react"
import { Bot, CheckCircle2, ShieldCheck } from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api"

type AssistantRun = {
  id: string
  status: "completed" | "confirmation_required" | "blocked" | "failed"
  response: string
  results: Array<{ name: string; status: string; output?: unknown }>
  confirmationRequired: Array<{ name: string; arguments: Record<string, unknown> }>
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The assistant could not complete that request."
}

export default function ClientAssistantPage() {
  const [prompt, setPrompt] = useState("")
  const [run, setRun] = useState<AssistantRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function ask(event: FormEvent) {
    event.preventDefault()
    if (!prompt.trim()) return
    setBusy(true)
    setError("")
    try {
      setRun(await apiFetch<AssistantRun>("/ai/client-assistant", {
        method: "POST",
        body: { prompt: prompt.trim() },
      }))
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!run) return
    setBusy(true)
    setError("")
    try {
      setRun(await apiFetch<AssistantRun>(`/ai/client-assistant/${run.id}/confirm`, { method: "POST" }))
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell title="AI assistant" subtitle="Understand your setup, usage, and performance or request a safe configuration change.">
      <Alert>
        <ShieldCheck />
        <AlertTitle>Restricted to this workspace</AlertTitle>
        <AlertDescription>The assistant cannot access provider secrets or another client. Changes such as pausing automation require an administrator to confirm the exact action.</AlertDescription>
      </Alert>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Ask RealtyTechAI</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={ask} className="space-y-3">
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000} rows={5} placeholder="Why is SMS not ready? How many leads responded? Change my business hours to 8–6." />
            <Button disabled={busy || !prompt.trim()}>{busy ? "Working…" : "Ask assistant"}</Button>
          </form>
          {error ? <Alert variant="destructive"><AlertTitle>Request failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          {run ? (
            <div className="space-y-3 rounded-lg border p-4">
              <p className="whitespace-pre-wrap text-sm">{run.response}</p>
              {run.results.length ? <div className="space-y-2">{run.results.map((result, index) => <div key={`${result.name}-${index}`} className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {result.name.replaceAll("_", " ")}</div>)}</div> : null}
              {run.confirmationRequired.length ? (
                <Alert><ShieldCheck /><AlertTitle>Confirmation required</AlertTitle><AlertDescription className="space-y-3"><p>The assistant proposes: {run.confirmationRequired.map((item) => item.name.replaceAll("_", " ")).join(", ")}.</p><Button type="button" onClick={confirm} disabled={busy}>Confirm exact changes</Button></AlertDescription></Alert>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </PageShell>
  )
}
