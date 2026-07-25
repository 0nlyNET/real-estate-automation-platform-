"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Pause, Play, UserRoundCheck } from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { AiConversationControls } from "@/components/ai/conversation-controls"

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
}

type Msg = {
  id: string
  direction: "inbound" | "outbound"
  channel: "sms" | "email"
  body: string
  createdAt: string
  status: "created" | "queued" | "sending" | "provider_accepted" | "sent" | "delivered" | "failed" | "received" | "draft" | "skipped" | "canceled"
  authorship?: "ai" | "human" | "template" | "system"
}

type Enrollment = { id: string; status: "active" | "paused" | "stopped" | "completed"; sequence?: { name: string } | null }

function statusLabel(status: Msg["status"]) {
  if (status === "provider_accepted" || status === "sent" || status === "delivered") return "Sent"
  if (status === "received") return "Received"
  if (status === "failed") return "Not sent"
  if (status === "queued" || status === "sending" || status === "created") return "Sending"
  return status.replaceAll("_", " ")
}

export default function InboxPage() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [notice, setNotice] = useState("")
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [draft, setDraft] = useState("")
  const [sendChannel, setSendChannel] = useState<"sms" | "email">("sms")
  const [busy, setBusy] = useState(false)

  const loadThreads = useCallback(async () => {
    setErr("")
    try {
      const rows = await apiFetch<ThreadRow[]>("/messaging/threads?scope=shared&take=100")
      const items = Array.isArray(rows) ? rows : []
      setThreads(items)
      const requested = new URLSearchParams(window.location.search).get("leadId")
      setActiveLeadId((current) => {
        if (requested && items.some((item) => item.leadId === requested)) return requested
        if (current && items.some((item) => item.leadId === current)) return current
        return items[0]?.leadId || null
      })
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "Conversations could not be loaded")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadThreads(), 0)
    return () => window.clearTimeout(timer)
  }, [loadThreads])

  const loadConversation = useCallback(async (leadId: string) => {
    try {
      const [messageRows, enrollmentRows] = await Promise.all([
        apiFetch<Msg[]>(`/messaging/threads/${leadId}`),
        apiFetch<Enrollment[]>(`/leads/${leadId}/enrollments`),
      ])
      setMessages(Array.isArray(messageRows) ? messageRows : [])
      const latest = Array.isArray(messageRows)
        ? messageRows[messageRows.length - 1]
        : null
      setSendChannel(latest?.channel || "sms")
      setEnrollments(Array.isArray(enrollmentRows) ? enrollmentRows : [])
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "The conversation could not be loaded")
    }
  }, [])

  useEffect(() => {
    if (!activeLeadId) {
      const timer = window.setTimeout(() => { setMessages([]); setEnrollments([]) }, 0)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => void loadConversation(activeLeadId), 0)
    return () => window.clearTimeout(timer)
  }, [activeLeadId, loadConversation])

  const activeThread = threads.find((item) => item.leadId === activeLeadId)
  const currentEnrollment = enrollments.find((item) => item.status === "active") || enrollments.find((item) => item.status === "paused") || enrollments[0]

  async function send() {
    if (!activeLeadId || !draft.trim()) return
    setBusy(true); setErr(""); setNotice("")
    try {
      await apiFetch("/messaging/send", { method: "POST", body: { leadId: activeLeadId, body: draft.trim(), channel: sendChannel } })
      setDraft(""); setNotice(sendChannel === "email" ? "Email queued." : "Message sent.")
      await Promise.all([loadConversation(activeLeadId), loadThreads()])
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "The message could not be sent")
    } finally { setBusy(false) }
  }

  async function changeFollowUp(action: "pause" | "resume") {
    if (!activeLeadId || !currentEnrollment) return
    setBusy(true); setErr("")
    try {
      await apiFetch(`/leads/${activeLeadId}/enrollments/${currentEnrollment.id}/${action}`, { method: "POST" })
      setNotice(action === "pause" ? "Automatic follow-up paused." : "Automatic follow-up resumed.")
      await loadConversation(activeLeadId)
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "Follow-up could not be changed")
    } finally { setBusy(false) }
  }

  async function requestPersonalFollowUp() {
    if (!activeLeadId) return
    setBusy(true); setErr("")
    try {
      await apiFetch("/client/handoffs", { method: "POST", body: { leadId: activeLeadId } })
      setNotice("Personal follow-up added to Today.")
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "The follow-up could not be added")
    } finally { setBusy(false) }
  }

  return (
    <PageShell title="Conversations" subtitle="Read the full history, reply, and know what to say next.">
      {err ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{err}</div> : null}
      {notice ? <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader><CardTitle>People</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <div className="p-4 text-sm text-muted-foreground">Loading conversations…</div> : null}
            <div className="max-h-[680px] divide-y overflow-y-auto">
              {threads.map((thread) => <button key={thread.leadId} type="button" onClick={() => setActiveLeadId(thread.leadId)} className={`w-full p-4 text-left hover:bg-muted/60 ${activeLeadId === thread.leadId ? "bg-muted" : ""}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{thread.leadName || "Lead"}</span>{thread.temperature ? <Badge variant={thread.temperature === "hot" ? "destructive" : "secondary"}>{thread.temperature}</Badge> : null}</div><div className="mt-1 truncate text-xs text-muted-foreground">{thread.lastMessageBody || "No message"}</div></button>)}
              {!loading && !threads.length ? <div className="p-8 text-center text-sm text-muted-foreground">No conversations yet.</div> : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {activeThread ? <Card><CardContent className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{activeThread.leadName}</h2><Badge variant="outline">{activeThread.readiness?.replaceAll("_", " ") || "qualifying"}</Badge></div><p className="mt-2 text-sm">{activeThread.conversationSummary || activeThread.temperatureReason || "Qualification is still in progress."}</p>{activeThread.blocker ? <p className="mt-1 text-sm text-muted-foreground">Current blocker: {activeThread.blocker}</p> : null}</div><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={`/app/leads/${activeThread.leadId}`}><UserRoundCheck className="mr-2 h-4 w-4" />Lead details</Link></Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void requestPersonalFollowUp()}><UserRoundCheck className="mr-2 h-4 w-4" />Add to Today</Button>{currentEnrollment ? currentEnrollment.status === "active" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void changeFollowUp("pause")}><Pause className="mr-2 h-4 w-4" />Pause follow-up</Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void changeFollowUp("resume")}><Play className="mr-2 h-4 w-4" />Resume follow-up</Button> : null}</div></div>{activeThread.talkingPoints?.length ? <details className="mt-3 rounded-lg bg-muted p-3 text-sm"><summary className="cursor-pointer font-medium">Suggested talking points</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{activeThread.talkingPoints.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}</CardContent></Card> : null}

          {activeLeadId ? (
            <AiConversationControls
              leadId={activeLeadId}
              onChanged={() =>
                Promise.all([loadConversation(activeLeadId), loadThreads()]).then(
                  () => undefined,
                )
              }
            />
          ) : null}

          <Card>
            <CardHeader><CardTitle>Messages</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="h-[420px] space-y-2 overflow-y-auto rounded-lg border p-3">
                {messages.map((message) => <div key={message.id} className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${message.direction === "outbound" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}><div>{message.body}</div><div className={`mt-1 text-[11px] ${message.direction === "outbound" ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{message.direction === "outbound" ? `${message.authorship === "ai" ? "AI-generated" : message.authorship === "template" ? "Approved automation" : "Human-written"} · ` : ""}{statusLabel(message.status)} · {new Date(message.createdAt).toLocaleString()}</div>{message.status === "failed" ? <div className="mt-1 text-xs font-medium">This message did not send. Try again or contact the lead another way.</div> : null}</div>)}
                {!messages.length ? <div className="p-6 text-center text-sm text-muted-foreground">Choose a conversation to see its messages.</div> : null}
              </div>
              <div className="flex gap-2"><select aria-label="Reply channel" className="h-10 rounded-md border bg-background px-3 text-sm" value={sendChannel} onChange={(event) => setSendChannel(event.target.value as "sms" | "email")}><option value="sms" disabled={!activeThread?.leadPhone}>Text</option><option value="email" disabled={!activeThread?.leadEmail}>Email</option></select><Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={sendChannel === "email" ? "Write an email reply…" : "Write a text message…"} aria-label="Message" /><Button disabled={!activeLeadId || !draft.trim() || busy || (sendChannel === "sms" ? !activeThread?.leadPhone : !activeThread?.leadEmail)} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</Button></div>
              <p className="text-xs text-muted-foreground">Manual replies use the selected channel and switch the conversation to human handling.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}
