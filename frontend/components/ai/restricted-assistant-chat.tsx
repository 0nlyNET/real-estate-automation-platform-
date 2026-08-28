"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, apiFetch } from "@/lib/api"

export type RestrictedAssistantRun = {
  id: string
  requestId: string
  status:
    | "processing"
    | "completed"
    | "confirmation_required"
    | "blocked"
    | "failed"
  response: string
  results: Array<{
    name: string
    status: "executed" | "failed"
    output?: unknown
    errorCode?: string
    message?: string
  }>
  confirmationRequired: Array<{
    name: string
    arguments: Record<string, unknown>
  }>
  error: { code: string; message: string } | null
  createdAt: string
}

type AssistantEntry = { prompt: string; run: RestrictedAssistantRun }
type AssistantHistory = { items: AssistantEntry[] }
type ProviderStatus = {
  available?: boolean
  configured?: boolean
  passed?: boolean
  model?: string | null
  testedModel?: string | null
  lastTestedAt?: string | null
  lastError?: string | null
  message?: string
}

function requestMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The request timed out before RealtyTechAI received a final result. Retry safely; the same request ID prevents duplicate actions."
  }
  return error instanceof Error
    ? error.message
    : "The assistant could not complete that request."
}

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return "Result details are unavailable."
  }
}

function ProviderReadiness({
  status,
  error,
  canTest,
  testing,
  onTest,
}: {
  status: ProviderStatus | null
  error: string
  canTest: boolean
  testing: boolean
  onTest: () => void
}) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>AI readiness could not be checked</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!status) return null
  const configured = status.configured ?? status.available ?? false
  const passed = status.passed ?? configured
  return (
    <Alert variant={configured && passed ? "default" : "destructive"}>
      {configured && passed ? <CheckCircle2 /> : <AlertCircle />}
      <AlertTitle>
        {configured && passed
          ? "AI provider ready"
          : configured
            ? "AI provider needs a controlled test"
            : "AI provider configuration required"}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {status.lastError ||
            status.message ||
            (configured
              ? `Configured model: ${status.testedModel || status.model || "default"}.`
              : "A platform administrator must set OPENAI_API_KEY in the backend production environment and redeploy.")}
        </p>
        {status.lastTestedAt ? (
          <p className="text-xs">
            Last controlled test: {new Date(status.lastTestedAt).toLocaleString()}
          </p>
        ) : null}
        {canTest ? (
          <Button type="button" size="sm" variant="outline" disabled={testing} onClick={onTest}>
            <RefreshCw className={testing ? "animate-spin" : ""} />
            {testing ? "Testing provider…" : "Run controlled provider test"}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

export function RestrictedAssistantChat({
  endpoint,
  statusEndpoint,
  providerTestEndpoint,
  canTestProvider = false,
  title,
  placeholder,
  submitLabel,
  confirmationTitle,
  confirmationButtonLabel,
}: {
  endpoint: string
  statusEndpoint: string
  providerTestEndpoint?: string
  canTestProvider?: boolean
  title: string
  placeholder: string
  submitLabel: string
  confirmationTitle: string
  confirmationButtonLabel: string
}) {
  const [prompt, setPrompt] = useState("")
  const [entries, setEntries] = useState<AssistantEntry[]>([])
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [busy, setBusy] = useState(false)
  const [testingProvider, setTestingProvider] = useState(false)
  const [error, setError] = useState("")
  const [historyError, setHistoryError] = useState("")
  const [statusError, setStatusError] = useState("")
  const [failedRequest, setFailedRequest] = useState<{
    prompt: string
    requestId: string
  } | null>(null)

  const load = useCallback(async () => {
    setLoadingHistory(true)
    const [historyResult, statusResult] = await Promise.allSettled([
      apiFetch<AssistantHistory>(`${endpoint}/history`),
      apiFetch<ProviderStatus>(statusEndpoint),
    ])
    if (historyResult.status === "fulfilled") {
      setEntries(historyResult.value.items || [])
      setHistoryError("")
    } else {
      setHistoryError(requestMessage(historyResult.reason))
    }
    if (statusResult.status === "fulfilled") {
      setProviderStatus(statusResult.value)
      setStatusError("")
    } else {
      setStatusError(requestMessage(statusResult.reason))
    }
    setLoadingHistory(false)
  }, [endpoint, statusEndpoint])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function submitRequest(nextPrompt: string, requestId: string) {
    setBusy(true)
    setError("")
    try {
      const run = await apiFetch<RestrictedAssistantRun>(endpoint, {
        method: "POST",
        body: { prompt: nextPrompt, requestId },
        signal: AbortSignal.timeout(50_000),
      })
      setEntries((current) => {
        const withoutRequest = current.filter(
          (entry) => entry.run.requestId !== run.requestId,
        )
        return [...withoutRequest, { prompt: nextPrompt, run }]
      })
      setPrompt("")
      setFailedRequest(null)
    } catch (cause) {
      setError(requestMessage(cause))
      setFailedRequest({ prompt: nextPrompt, requestId })
    } finally {
      setBusy(false)
    }
  }

  function ask(event: FormEvent) {
    event.preventDefault()
    const nextPrompt = prompt.trim()
    if (!nextPrompt || busy) return
    void submitRequest(nextPrompt, crypto.randomUUID())
  }

  async function confirm(run: RestrictedAssistantRun) {
    setBusy(true)
    setError("")
    try {
      const updated = await apiFetch<RestrictedAssistantRun>(
        `${endpoint}/${run.id}/confirm`,
        { method: "POST", signal: AbortSignal.timeout(30_000) },
      )
      setEntries((current) =>
        current.map((entry) =>
          entry.run.id === updated.id ? { ...entry, run: updated } : entry,
        ),
      )
    } catch (cause) {
      setError(requestMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function testProvider() {
    if (!providerTestEndpoint) return
    setTestingProvider(true)
    setStatusError("")
    try {
      setProviderStatus(
        await apiFetch<ProviderStatus>(providerTestEndpoint, {
          method: "POST",
          signal: AbortSignal.timeout(45_000),
        }),
      )
    } catch (cause) {
      setStatusError(requestMessage(cause))
    } finally {
      setTestingProvider(false)
    }
  }

  return (
    <div className="space-y-4">
      <ProviderReadiness
        status={providerStatus}
        error={statusError}
        canTest={Boolean(canTestProvider && providerTestEndpoint)}
        testing={testingProvider}
        onTest={() => void testProvider()}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={ask} className="space-y-3">
            <Textarea
              aria-label="Assistant message"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={4000}
              rows={5}
              placeholder={placeholder}
            />
            <Button disabled={busy || !prompt.trim()}>
              {busy ? "Working…" : submitLabel}
            </Button>
          </form>
          {error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Request failed</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error}</p>
                {failedRequest ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void submitRequest(
                        failedRequest.prompt,
                        failedRequest.requestId,
                      )
                    }
                  >
                    Retry the same request safely
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {historyError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Conversation history unavailable</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{historyError}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                  Retry history
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {loadingHistory ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4 animate-pulse" /> Loading conversation history…
            </div>
          ) : entries.length ? (
            <div className="space-y-5" aria-label="Assistant conversation history">
              {entries.map((entry) => (
                <div key={entry.run.requestId} className="space-y-3">
                  <div className="ml-auto max-w-3xl rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground">
                    <p className="whitespace-pre-wrap">{entry.prompt}</p>
                  </div>
                  <div className="max-w-3xl space-y-3 rounded-lg border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Bot className="h-4 w-4" />
                      <span className="text-sm font-medium">RealtyTechAI</span>
                      <Badge variant={entry.run.status === "failed" ? "destructive" : "outline"}>
                        {entry.run.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    {entry.run.response ? (
                      <p className="whitespace-pre-wrap text-sm">{entry.run.response}</p>
                    ) : null}
                    {entry.run.error ? (
                      <Alert variant="destructive">
                        <AlertCircle />
                        <AlertTitle>{entry.run.error.code.replaceAll("_", " ")}</AlertTitle>
                        <AlertDescription>{entry.run.error.message}</AlertDescription>
                      </Alert>
                    ) : null}
                    {entry.run.results.map((result, index) => (
                      <div key={`${result.name}-${index}`} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center gap-2">
                          {result.status === "executed" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          )}
                          <span className="font-medium">{result.name.replaceAll("_", " ")}</span>
                          <Badge variant={result.status === "executed" ? "secondary" : "destructive"}>
                            {result.status}
                          </Badge>
                        </div>
                        {result.message ? <p className="mt-2 text-muted-foreground">{result.message}</p> : null}
                        {result.output !== undefined ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-muted-foreground">Verified result details</summary>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
                              {pretty(result.output)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ))}
                    {entry.run.confirmationRequired.length ? (
                      <Alert>
                        <ShieldCheck />
                        <AlertTitle>{confirmationTitle}</AlertTitle>
                        <AlertDescription className="space-y-3">
                          {entry.run.confirmationRequired.map((item) => (
                            <div key={item.name} className="rounded border p-2">
                              <div className="font-medium">{item.name.replaceAll("_", " ")}</div>
                              <pre className="mt-1 overflow-auto whitespace-pre-wrap text-xs">
                                {pretty(item.arguments)}
                              </pre>
                            </div>
                          ))}
                          <Button
                            type="button"
                            disabled={busy}
                            onClick={() => void confirm(entry.run)}
                          >
                            {confirmationButtonLabel}
                          </Button>
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No assistant messages yet. Ask a question to start a secure, workspace-scoped conversation.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
