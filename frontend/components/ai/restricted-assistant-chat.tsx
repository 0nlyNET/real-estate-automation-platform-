"use client"

import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
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
  if (error instanceof ApiError) {
    if (error.code === "ASSISTANT_REQUEST_IN_PROGRESS") {
      return "RealtyTechAI is still working on this message. Its result will appear here automatically."
    }
    if (error.code === "AI_PROVIDER_RATE_LIMITED") {
      return "The AI provider is busy right now. Wait a moment, then retry this message."
    }
    if (error.code === "AI_PROVIDER_TIMEOUT") {
      return "The AI provider took too long to respond. Retry this message safely."
    }
    if (error.status === 403) {
      return "This request is not available for your current workspace role or service state."
    }
    return error.message
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The request timed out before RealtyTechAI received a final result. Retry safely; the same request ID prevents duplicate actions."
  }
  return error instanceof Error
    ? error.message
    : "The assistant could not complete that request."
}

function requestOutcomeMayStillComplete(error: unknown) {
  if (error instanceof ApiError) {
    return error.code === "ASSISTANT_REQUEST_IN_PROGRESS"
  }
  return (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    error instanceof TypeError
  )
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
  const failedRequestRef = useRef<{
    prompt: string
    requestId: string
  } | null>(null)
  const [pendingRequest, setPendingRequest] = useState<{
    prompt: string
    requestId: string
  } | null>(null)
  const [uncertainRequestId, setUncertainRequestId] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottom = useRef(true)

  const applyHistory = useCallback((items: AssistantEntry[]) => {
    setEntries(items)
    const failed = failedRequestRef.current
    const recovered = failed
      ? items.find((entry) => entry.run.requestId === failed.requestId)
      : null
    if (
      recovered?.run.status === "completed" ||
      recovered?.run.status === "confirmation_required"
    ) {
      failedRequestRef.current = null
      setFailedRequest(null)
      setError("")
    }
    if (recovered && recovered.run.status !== "processing") {
      setUncertainRequestId(null)
    }
    setPendingRequest((current) => {
      if (!current) return null
      const persisted = items.find(
        (entry) => entry.run.requestId === current.requestId,
      )
      return persisted && persisted.run.status !== "processing" ? null : current
    })
  }, [])

  const load = useCallback(async () => {
    setLoadingHistory(true)
    const [historyResult, statusResult] = await Promise.allSettled([
      apiFetch<AssistantHistory>(`${endpoint}/history`),
      apiFetch<ProviderStatus>(statusEndpoint),
    ])
    if (historyResult.status === "fulfilled") {
      applyHistory(historyResult.value.items || [])
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
  }, [applyHistory, endpoint, statusEndpoint])

  const refreshHistory = useCallback(async () => {
    try {
      const history = await apiFetch<AssistantHistory>(`${endpoint}/history`)
      applyHistory(history.items || [])
      setHistoryError("")
    } catch (cause) {
      setHistoryError(requestMessage(cause))
    }
  }, [applyHistory, endpoint])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const processing = entries.some((entry) => entry.run.status === "processing")
    const uncertainRun = uncertainRequestId
      ? entries.find(
          (entry) => entry.run.requestId === uncertainRequestId,
        )
      : null
    const awaitingPersistedResult = Boolean(
      uncertainRequestId &&
        (!uncertainRun || uncertainRun.run.status === "processing"),
    )
    if (!processing && !awaitingPersistedResult) return
    const interval = window.setInterval(() => void refreshHistory(), 2_500)
    return () => window.clearInterval(interval)
  }, [entries, refreshHistory, uncertainRequestId])

  useLayoutEffect(() => {
    if (!shouldStickToBottom.current) return
    bottomRef.current?.scrollIntoView({
      behavior: loadingHistory ? "auto" : "smooth",
      block: "end",
    })
  }, [busy, entries, loadingHistory, pendingRequest])

  async function submitRequest(nextPrompt: string, requestId: string) {
    setBusy(true)
    setError("")
    setPendingRequest({ prompt: nextPrompt, requestId })
    shouldStickToBottom.current = true
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
        return [...withoutRequest, { prompt: nextPrompt, run }].sort(
          (left, right) =>
            new Date(left.run.createdAt).getTime() -
            new Date(right.run.createdAt).getTime(),
        )
      })
      setPendingRequest(null)
      setUncertainRequestId(null)
      failedRequestRef.current = null
      setFailedRequest(null)
    } catch (cause) {
      setError(requestMessage(cause))
      failedRequestRef.current = { prompt: nextPrompt, requestId }
      setFailedRequest({ prompt: nextPrompt, requestId })
      if (requestOutcomeMayStillComplete(cause)) {
        setUncertainRequestId(requestId)
      } else {
        setPendingRequest(null)
        setUncertainRequestId(null)
      }
      await refreshHistory()
    } finally {
      setBusy(false)
    }
  }

  function ask(event: FormEvent) {
    event.preventDefault()
    const nextPrompt = prompt.trim()
    if (!nextPrompt || busy) return
    setPrompt("")
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

  const pendingIsPersisted = Boolean(
    pendingRequest &&
      entries.some(
        (entry) => entry.run.requestId === pendingRequest.requestId,
      ),
  )
  const showTechnicalDetails = endpoint.startsWith("/admin/")

  return (
    <div className="space-y-4">
      <ProviderReadiness
        status={providerStatus}
        error={statusError}
        canTest={Boolean(canTestProvider && providerTestEndpoint)}
        testing={testingProvider}
        onTest={() => void testProvider()}
      />
      <Card className="h-[min(76vh,780px)] min-h-[560px] gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col px-0">
          <div
            ref={viewportRef}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
            onScroll={() => {
              const viewport = viewportRef.current
              if (!viewport) return
              shouldStickToBottom.current =
                viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96
            }}
          >
            {historyError ? (
              <Alert variant="destructive" className="mb-4">
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
                          <AlertTitle>Assistant request failed</AlertTitle>
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
                          {showTechnicalDetails && result.output !== undefined ? (
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
                            <Button type="button" disabled={busy} onClick={() => void confirm(entry.run)}>
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
            {pendingRequest && !pendingIsPersisted ? (
              <div className="mt-5 space-y-3" aria-live="polite">
                <div className="ml-auto max-w-3xl rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground">
                  <p className="whitespace-pre-wrap">{pendingRequest.prompt}</p>
                </div>
                <div className="flex max-w-3xl items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <Clock3 className="h-4 w-4 animate-pulse" /> RealtyTechAI is thinking…
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} aria-hidden="true" />
          </div>

          <div className="border-t bg-background p-4 sm:p-5">
            {error ? (
              <Alert variant="destructive" className="mb-3">
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
                      onClick={() => void submitRequest(failedRequest.prompt, failedRequest.requestId)}
                    >
                      Retry the same request safely
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <form onSubmit={ask} className="flex items-end gap-2">
              <Textarea
                aria-label="Assistant message"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                maxLength={4000}
                rows={2}
                className="max-h-36 min-h-11 resize-none"
                placeholder={placeholder}
              />
              <Button className="shrink-0" disabled={busy || !prompt.trim()}>
                {busy ? "Working…" : submitLabel}
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">Enter sends · Shift+Enter adds a new line.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
