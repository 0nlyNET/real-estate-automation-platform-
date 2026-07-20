"use client"

import { useEffect, useMemo, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type ThreadRow = {
  leadId: string | null
  leadName?: string | null
  lastMessageBody?: string | null
  lastMessageAt?: string | null
}

type Msg = {
  id: string
  direction?: "inbound" | "outbound"
  body?: string
  createdAt?: string
  status?: "created" | "queued" | "sending" | "provider_accepted" | "sent" | "delivered" | "failed" | "received" | "skipped" | "canceled"
  providerStatus?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

type Scope = "mine" | "team" | "shared"

function statusLabel(status?: Msg["status"]) {
  if (!status) return "Unknown"
  if (status === "provider_accepted") return "Provider accepted"
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ")
}

export default function InboxPage() {
  const [scope, setScope] = useState<Scope>("mine")
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState("")

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        setErr(null)

        const rows = await apiFetch(`/messaging/threads?scope=${scope}`)
        if (!mounted) return
        const items = Array.isArray(rows) ? rows : []
        setThreads(items)

        const firstLeadId = (items[0]?.leadId as string | null) || null
        setActiveLeadId(firstLeadId)
      } catch (e: any) {
        if (!mounted) return
        setErr(e?.message || "Failed to load inbox")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [scope])

  useEffect(() => {
    let mounted = true
    async function loadMessages() {
      if (!activeLeadId) {
        setMessages([])
        return
      }
      try {
        const rows = await apiFetch(`/messaging/threads/${activeLeadId}`)
        if (!mounted) return
        setMessages(Array.isArray(rows) ? rows : [])
      } catch {
        if (!mounted) return
        setMessages([])
      }
    }
    loadMessages()
    return () => {
      mounted = false
    }
  }, [activeLeadId])

  const scopeButtons = useMemo(() => {
    const btn = (label: string, value: Scope) => (
      <Button
        key={value}
        size="sm"
        variant={scope === value ? "default" : "outline"}
        onClick={() => setScope(value)}
      >
        {label}
      </Button>
    )
    return [
      btn("Personal", "mine"),
      btn("Team", "team"),
      btn("Shared", "shared"),
    ]
  }, [scope])

  async function send() {
    if (!activeLeadId) return
    const body = draft.trim()
    if (!body) return

    setDraft("")
    try {
      await apiFetch(`/messaging/send`, {
        method: "POST",
        body: { leadId: activeLeadId, body },
      })
      const rows = await apiFetch(`/messaging/threads/${activeLeadId}`)
      setMessages(Array.isArray(rows) ? rows : [])
    } catch (e: any) {
      setErr(e?.message || "Send failed")
    }
  }

  return (
    <PageShell title="Inbox" subtitle="Reply fast, stay compliant, and keep routing tight.">
      <div className="flex items-center gap-2">{scopeButtons}</div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Threads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
            {err ? <div className="text-sm text-red-500">{err}</div> : null}
            <div className="divide-y rounded border">
              {threads.map((t, idx) => {
                const id = t.leadId || `row-${idx}`
                return (
                  <button
                    key={id}
                    onClick={() => t.leadId && setActiveLeadId(t.leadId)}
                    className={`w-full text-left p-3 hover:bg-muted/50 ${activeLeadId === t.leadId ? "bg-muted/50" : ""}`}
                    disabled={!t.leadId}
                  >
                    <div className="text-sm font-medium truncate">{t.leadName || "Lead"}</div>
                    <div className="text-xs text-muted-foreground truncate">{t.lastMessageBody || ""}</div>
                  </button>
                )
              })}
              {threads.length === 0 && !loading ? (
                <div className="p-3 text-sm text-muted-foreground">No threads.</div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Messages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-[420px] overflow-y-auto rounded border p-3 space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded px-3 py-2 text-sm ${m.direction === "outbound" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  <div>{m.body || ""}</div>
                  <div className={`mt-1 text-[11px] ${m.direction === "outbound" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {statusLabel(m.status)}
                    {m.providerStatus ? ` · provider: ${m.providerStatus}` : ""}
                  </div>
                  {m.status === "failed" && m.errorMessage ? (
                    <div className="mt-1 text-xs font-medium">Failed: {m.errorMessage}</div>
                  ) : null}
                </div>
              ))}
              {messages.length === 0 ? <div className="text-sm text-muted-foreground">No messages.</div> : null}
            </div>

            <div className="flex gap-2">
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a reply..." />
              <Button onClick={send} disabled={!activeLeadId}>Send</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
