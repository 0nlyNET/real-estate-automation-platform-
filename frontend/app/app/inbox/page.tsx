"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { Pause, Play, UserRoundCheck } from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { ApiError, apiFetch } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { AiConversationControls } from "@/components/ai/conversation-controls"
import { fetchMe, type Me } from "@/lib/me"

type ThreadRow = {
  leadId: string | null
  leadName?: string | null
  leadPhone?: string | null
  leadEmail?: string | null
  lastMessageBody?: string | null
  lastMessageAt?: string | null
  temperature?: string
  temperatureReason?: string | null
  readiness?: string
  blocker?: string | null
  conversationSummary?: string | null
  talkingPoints?: string[]
  channel?: "sms" | "email"
  status?: Msg["status"]
  providerStatus?: string | null
  assignedToUserId?: string | null
  isAssignedToViewer?: boolean
}

type Msg = {
  id: string
  direction: "inbound" | "outbound"
  channel: "sms" | "email"
  body: string
  createdAt: string
  status: "created" | "queued" | "sending" | "provider_accepted" | "sent" | "delivered" | "failed" | "received" | "draft" | "skipped" | "blocked" | "canceled" | "pending" | "scheduled"
  providerStatus?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  authorship?: "ai" | "human" | "template" | "system"
}

type Enrollment = { id: string; status: "active" | "paused" | "stopped" | "completed"; sequence?: { name: string } | null }

type SendResult = {
  status: Msg["status"]
  duplicate?: boolean
  message: Msg
}

type PendingSend = {
  leadId: string
  body: string
  channel: "sms" | "email"
  requestId: string
}

type SendFailure = {
  message: string
  pending: PendingSend
}

function statusLabel(status: Msg["status"]) {
  if (status === "provider_accepted") return "Provider accepted"
  if (status === "sent") return "Sent"
  if (status === "delivered") return "Delivered"
  if (status === "received") return "Received"
  if (status === "failed") return "Failed"
  if (status === "queued" || status === "pending") return "Queued"
  if (status === "sending" || status === "created") return "Processing"
  if (status === "scheduled") return "Scheduled"
  if (status === "blocked") return "Paused"
  if (status === "skipped") return "Human review"
  return status.replaceAll("_", " ")
}

function sendErrorMessage(cause: unknown, channel: "sms" | "email") {
  if (cause instanceof ApiError) {
    if (cause.code === "SMS_INTEGRATION_DISCONNECTED") {
      return "SMS is not connected. Ask a workspace administrator to finish Twilio setup in Integrations."
    }
    if (cause.code === "EMAIL_INTEGRATION_DISCONNECTED") {
      return "Email is not connected. Ask a workspace administrator to finish SendGrid setup in Integrations."
    }
    if (cause.code === "SERVICE_NOT_ENTITLED") {
      return "Manual replies are unavailable for the workspace's current billing or service state."
    }
    if (cause.code === "MESSAGE_REQUEST_ID_REUSED") {
      return "That retry no longer matches the original message. Send it as a new message instead."
    }
    if (cause.status === 403) {
      return "You no longer have permission to reply to this conversation."
    }
    return cause.message
  }
  return cause instanceof Error
    ? cause.message
    : `${channel === "sms" ? "Text" : "Email"} could not be queued.`
}

export default function InboxPage() {
  const [loading, setLoading] = useState(true)
  const [threadError, setThreadError] = useState("")
  const [conversationError, setConversationError] = useState("")
  const [actionError, setActionError] = useState("")
  const [notice, setNotice] = useState("")
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loadedLeadId, setLoadedLeadId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sendChannel, setSendChannel] = useState<"sms" | "email">("sms")
  const [busy, setBusy] = useState(false)
  const [sendFailures, setSendFailures] = useState<Record<string, SendFailure>>({})
  const [scope, setScope] = useState<"shared" | "mine">("shared")
  const [me, setMe] = useState<Me | null>(null)
  const messageViewportRef = useRef<HTMLDivElement | null>(null)
  const messageBottomRef = useRef<HTMLDivElement | null>(null)
  const activeLeadIdRef = useRef<string | null>(null)
  const shouldStickToBottom = useRef(true)
  const channelLeadRef = useRef<string | null>(null)
  const requestedLeadIdConsumed = useRef(false)
  const draft = activeLeadId ? drafts[activeLeadId] || "" : ""
  const setDraft = useCallback(
    (value: string) => {
      if (!activeLeadId) return
      setDrafts((current) => ({ ...current, [activeLeadId]: value }))
    },
    [activeLeadId],
  )

  const loadThreads = useCallback(async () => {
    try {
      const rows = await apiFetch<ThreadRow[]>(`/messaging/threads?scope=${scope}&take=100`)
      const items = Array.isArray(rows) ? rows : []
      setThreads(items)
      const requested = requestedLeadIdConsumed.current
        ? null
        : new URLSearchParams(window.location.search).get("leadId")
      requestedLeadIdConsumed.current = true
      setActiveLeadId((current) => {
        const next =
          requested && items.some((item) => item.leadId === requested)
            ? requested
            : current && items.some((item) => item.leadId === current)
              ? current
              : items[0]?.leadId || null
        activeLeadIdRef.current = next
        return next
      })
      setThreadError("")
    } catch (cause) {
      setThreadError(cause instanceof Error ? cause.message : "Conversations could not be loaded")
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadThreads(), 0)
    return () => window.clearTimeout(timer)
  }, [loadThreads])

  useEffect(() => {
    void fetchMe()
      .then(setMe)
      .catch(() => setThreadError("Your conversation permissions could not be checked. Refresh and try again."))
  }, [])

  useEffect(() => {
    activeLeadIdRef.current = activeLeadId
  }, [activeLeadId])

  useEffect(() => {
    const interval = window.setInterval(() => void loadThreads(), 10_000)
    return () => window.clearInterval(interval)
  }, [loadThreads])

  const loadConversation = useCallback(async (leadId: string) => {
    try {
      const [messageRows, enrollmentRows] = await Promise.all([
        apiFetch<Msg[]>(`/messaging/threads/${leadId}`),
        apiFetch<Enrollment[]>(`/leads/${leadId}/enrollments`),
      ])
      if (activeLeadIdRef.current !== leadId) return
      setMessages(Array.isArray(messageRows) ? messageRows : [])
      const latest = Array.isArray(messageRows)
        ? messageRows[messageRows.length - 1]
        : null
      if (channelLeadRef.current !== leadId) {
        channelLeadRef.current = leadId
        setSendChannel(latest?.channel || "sms")
      }
      setEnrollments(Array.isArray(enrollmentRows) ? enrollmentRows : [])
      setLoadedLeadId(leadId)
      setConversationError("")
    } catch (cause) {
      if (activeLeadIdRef.current !== leadId) return
      setConversationError(cause instanceof Error ? cause.message : "The conversation could not be loaded")
    }
  }, [])

  useEffect(() => {
    shouldStickToBottom.current = true
    const timer = window.setTimeout(() => {
      setConversationError("")
      setActionError("")
      setNotice("")
      if (!activeLeadId) {
        setMessages([])
        setEnrollments([])
        setLoadedLeadId(null)
        return
      }
      void loadConversation(activeLeadId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeLeadId, loadConversation])

  useLayoutEffect(() => {
    if (!shouldStickToBottom.current) return
    messageBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [activeLeadId, loadedLeadId, messages])

  useEffect(() => {
    if (!activeLeadId) return
    const interval = window.setInterval(
      () => void loadConversation(activeLeadId),
      7_500,
    )
    return () => window.clearInterval(interval)
  }, [activeLeadId, loadConversation])

  const activeThread = threads.find((item) => item.leadId === activeLeadId)
  const visibleMessages = loadedLeadId === activeLeadId ? messages : []
  const visibleEnrollments = loadedLeadId === activeLeadId ? enrollments : []
  const currentEnrollment = visibleEnrollments.find((item) => item.status === "active") || visibleEnrollments.find((item) => item.status === "paused") || visibleEnrollments[0]
  const canManageAny = me?.role === "owner" || me?.role === "admin"
  const canAct = Boolean(activeThread && (canManageAny || activeThread.isAssignedToViewer))
  const sendFailure = activeLeadId ? sendFailures[activeLeadId] : undefined
  const replyChannel =
    sendChannel === "sms" && !activeThread?.leadPhone && activeThread?.leadEmail
      ? "email"
      : sendChannel === "email" && !activeThread?.leadEmail && activeThread?.leadPhone
        ? "sms"
        : sendChannel

  async function send(retry?: PendingSend) {
    const pending: PendingSend | null = retry || (activeLeadId && draft.trim()
      ? {
          leadId: activeLeadId,
          body: draft.trim(),
          channel: replyChannel,
          requestId: crypto.randomUUID(),
        }
      : null)
    if (!pending || pending.leadId !== activeLeadIdRef.current) return
    setBusy(true)
    setSendFailures((current) => {
      if (!current[pending.leadId]) return current
      const next = { ...current }
      delete next[pending.leadId]
      return next
    })
    setNotice("")
    shouldStickToBottom.current = true
    try {
      const result = await apiFetch<SendResult>("/messaging/send", {
        method: "POST",
        body: pending,
      })
      if (activeLeadIdRef.current === pending.leadId) {
        setMessages((current) =>
          [...current.filter((message) => message.id !== result.message.id), result.message].sort(
            (left, right) =>
              new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
          ),
        )
        setLoadedLeadId(pending.leadId)
        setNotice(
          `${pending.channel === "email" ? "Email" : "Text"} queued for delivery. Provider status will update here automatically.`,
        )
      }
      setDrafts((current) =>
        (current[pending.leadId] || "").trim() === pending.body
          ? { ...current, [pending.leadId]: "" }
          : current,
      )
      await loadThreads()
    } catch (cause) {
      setSendFailures((current) => ({
        ...current,
        [pending.leadId]: {
          message: sendErrorMessage(cause, pending.channel),
          pending,
        },
      }))
    } finally {
      setBusy(false)
    }
  }

  async function changeFollowUp(action: "pause" | "resume") {
    if (!activeLeadId || !currentEnrollment) return
    setBusy(true); setActionError("")
    try {
      await apiFetch(`/leads/${activeLeadId}/enrollments/${currentEnrollment.id}/${action}`, { method: "POST" })
      setNotice(action === "pause" ? "Automatic follow-up paused." : "Automatic follow-up resumed.")
      await loadConversation(activeLeadId)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Follow-up could not be changed")
    } finally { setBusy(false) }
  }

  async function requestPersonalFollowUp() {
    if (!activeLeadId) return
    setBusy(true); setActionError("")
    try {
      await apiFetch("/client/handoffs", { method: "POST", body: { leadId: activeLeadId } })
      setNotice("Personal follow-up added to Today.")
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The follow-up could not be added")
    } finally { setBusy(false) }
  }

  return (
    <PageShell title="Conversations" subtitle="Read the full history, reply, and know what to say next.">
      {threadError || conversationError || actionError ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{threadError || conversationError || actionError}</div> : null}
      {notice ? <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader><CardTitle>People</CardTitle><div className="flex gap-2"><Button size="sm" variant={scope === "shared" ? "default" : "outline"} onClick={() => setScope("shared")}>Shared</Button><Button size="sm" variant={scope === "mine" ? "default" : "outline"} onClick={() => setScope("mine")}>Assigned to me</Button></div></CardHeader>
          <CardContent className="p-0">
            {loading ? <div className="p-4 text-sm text-muted-foreground">Loading conversations…</div> : null}
            <div className="max-h-[680px] divide-y overflow-y-auto">
              {threads.map((thread) => <button key={thread.leadId} type="button" onClick={() => { activeLeadIdRef.current = thread.leadId; channelLeadRef.current = thread.leadId; setActiveLeadId(thread.leadId); setSendChannel(thread.channel === "email" && thread.leadEmail ? "email" : thread.leadPhone ? "sms" : "email") }} className={`w-full p-4 text-left hover:bg-muted/60 ${activeLeadId === thread.leadId ? "bg-muted" : ""}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{thread.leadName || "Lead"}</span>{thread.temperature ? <Badge variant={thread.temperature === "hot" ? "destructive" : "secondary"}>{thread.temperature}</Badge> : null}</div><div className="mt-1 truncate text-xs text-muted-foreground">{thread.lastMessageBody || "No message"}</div>{thread.status ? <div className="mt-1 text-[11px] text-muted-foreground">{statusLabel(thread.status)}</div> : null}</button>)}
              {!loading && !threads.length ? <div className="p-8 text-center text-sm text-muted-foreground">No conversations yet.</div> : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {activeThread ? <Card><CardContent className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{activeThread.leadName}</h2><Badge variant="outline">{activeThread.readiness?.replaceAll("_", " ") || "qualifying"}</Badge>{!canAct ? <Badge variant="secondary">Shared read-only</Badge> : null}</div><p className="mt-2 text-sm">{activeThread.conversationSummary || activeThread.temperatureReason || "Qualification is still in progress."}</p>{activeThread.blocker ? <p className="mt-1 text-sm text-muted-foreground">Current blocker: {activeThread.blocker}</p> : null}</div><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={`/app/leads/${activeThread.leadId}`}><UserRoundCheck className="mr-2 h-4 w-4" />Lead details</Link></Button><Button size="sm" variant="outline" disabled={busy || !canAct} onClick={() => void requestPersonalFollowUp()}><UserRoundCheck className="mr-2 h-4 w-4" />Add to Today</Button>{currentEnrollment ? currentEnrollment.status === "active" ? <Button size="sm" variant="outline" disabled={busy || !canAct} onClick={() => void changeFollowUp("pause")}><Pause className="mr-2 h-4 w-4" />Pause follow-up</Button> : <Button size="sm" variant="outline" disabled={busy || !canAct} onClick={() => void changeFollowUp("resume")}><Play className="mr-2 h-4 w-4" />Resume follow-up</Button> : null}</div></div>{activeThread.talkingPoints?.length ? <details className="mt-3 rounded-lg bg-muted p-3 text-sm"><summary className="cursor-pointer font-medium">Suggested talking points</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{activeThread.talkingPoints.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}</CardContent></Card> : null}

          {activeLeadId && canAct ? (
            <AiConversationControls
              leadId={activeLeadId}
              onChanged={() =>
                Promise.all([loadConversation(activeLeadId), loadThreads()]).then(
                  () => undefined,
                )
              }
            />
          ) : null}

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4"><CardTitle>Messages</CardTitle></CardHeader>
            <CardContent className="px-0">
              <div
                ref={messageViewportRef}
                className="h-[min(55vh,520px)] min-h-[360px] space-y-2 overflow-y-auto p-3 sm:p-4"
                onScroll={() => {
                  const viewport = messageViewportRef.current
                  if (!viewport) return
                  shouldStickToBottom.current =
                    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96
                }}
              >
                {visibleMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${message.direction === "outbound" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    <div className="whitespace-pre-wrap">{message.body}</div>
                    <div className={`mt-1 text-[11px] ${message.direction === "outbound" ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                      {message.direction === "outbound" ? `${message.authorship === "ai" ? "AI-generated" : message.authorship === "template" ? "Approved automation" : "Human-written"} · ` : ""}
                      {statusLabel(message.status)}
                      {message.providerStatus && message.providerStatus !== message.status ? ` · ${message.providerStatus.replaceAll("_", " ")}` : ""}
                      {` · ${new Date(message.createdAt).toLocaleString()}`}
                    </div>
                    {message.status === "failed" ? (
                      <div className="mt-2 space-y-2 text-xs font-medium">
                        <p>This message did not send. {message.errorMessage || "Check the connection before trying again."}</p>
                        {canAct && activeLeadId && message.errorCode !== "PROVIDER_RESULT_UNKNOWN" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void send({
                              leadId: activeLeadId,
                              body: message.body,
                              channel: message.channel,
                              requestId: crypto.randomUUID(),
                            })}
                          >
                            Retry as a new message
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {message.status === "blocked" || message.status === "skipped" ? <div className="mt-1 text-xs font-medium">Human review is required before this conversation can continue.</div> : null}
                  </div>
                ))}
                {!visibleMessages.length ? <div className="flex min-h-72 items-center justify-center p-6 text-center text-sm text-muted-foreground">{activeLeadId && loadedLeadId === activeLeadId ? "No messages yet. Write the first reply below." : activeLeadId ? "Loading conversation…" : "Choose a conversation to see its messages."}</div> : null}
                <div ref={messageBottomRef} aria-hidden="true" />
              </div>

              <div className="border-t bg-background p-3 sm:p-4">
                {sendFailure ? (
                  <div role="alert" className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                    <p>{sendFailure.message}</p>
                    <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void send(sendFailure.pending)}>
                      Retry the same message safely
                    </Button>
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <select
                    aria-label="Reply channel"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={replyChannel}
                    disabled={!canAct}
                    onChange={(event) => {
                      channelLeadRef.current = activeLeadId
                      setSendChannel(event.target.value as "sms" | "email")
                      if (!activeLeadId) return
                      setSendFailures((current) => {
                        if (!current[activeLeadId]) return current
                        const next = { ...current }
                        delete next[activeLeadId]
                        return next
                      })
                    }}
                  >
                    <option value="sms" disabled={!activeThread?.leadPhone}>Text</option>
                    <option value="email" disabled={!activeThread?.leadEmail}>Email</option>
                  </select>
                  <Textarea
                    value={draft}
                    disabled={!canAct}
                    maxLength={1600}
                    rows={2}
                    className="max-h-32 min-h-10 resize-none"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void send()
                      }
                    }}
                    placeholder={canAct ? (replyChannel === "email" ? "Write an email reply…" : "Write a text message…") : "Assign this conversation to reply"}
                    aria-label="Message"
                  />
                  <Button
                    className="shrink-0"
                    disabled={!canAct || !activeLeadId || !draft.trim() || busy || (replyChannel === "sms" ? !activeThread?.leadPhone : !activeThread?.leadEmail)}
                    onClick={() => void send()}
                  >
                    {busy ? "Sending…" : "Send"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Enter sends · Shift+Enter adds a new line. Replies are queued through the selected provider and switch the conversation to human handling.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}
