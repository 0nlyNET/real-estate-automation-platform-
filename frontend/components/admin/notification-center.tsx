"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, BellRing, CheckCheck } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"

type NotificationItem = {
  id: string
  title: string
  message: string
  severity: "info" | "success" | "warning" | "critical"
  category: string
  actionUrl?: string | null
  readAt?: string | null
  createdAt: string
}

type Summary = { unread: number }
type Preferences = {
  emailEnabled: boolean
  inAppEnabled: boolean
}

export function NotificationCenter({ audience = "admin" }: { audience?: "admin" | "client" }) {
  const router = useRouter()
  const basePath = audience === "client" ? "/notifications" : "/admin/notifications"
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [summary, setSummary] = useState<Summary>({ unread: 0 })
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [message, setMessage] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [severityFilter, setSeverityFilter] = useState("all")
  const [readFilter, setReadFilter] = useState("all")
  const [marking, setMarking] = useState(false)
  const markingRef = useRef(false)
  const loadVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++loadVersion.current
    try {
      const query = new URLSearchParams({ take: "30" })
      if (categoryFilter !== "all") query.set("category", categoryFilter)
      if (severityFilter !== "all") query.set("severity", severityFilter)
      if (readFilter !== "all") query.set("read", readFilter)
      const results = await Promise.allSettled([
        apiFetch<NotificationItem[]>(`${basePath}?${query.toString()}`).then((value) => { if (version === loadVersion.current) setItems(value) }),
        apiFetch<Summary>(`${basePath}/summary`).then((value) => { if (version === loadVersion.current) setSummary(value) }),
        apiFetch<Preferences>(`${basePath}/preferences/me`).then((value) => { if (version === loadVersion.current) setPreferences(value) }),
      ])
      if (version !== loadVersion.current) return
      if (results.some((result) => result.status === "rejected")) setMessage("Some notifications could not be loaded. Please retry.")
    } catch {
      setMessage("Notifications could not be loaded.")
    }
  }, [basePath, categoryFilter, readFilter, severityFilter])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
    }
  }, [load])

  async function updatePreferences(patch: Partial<Preferences>) {
    const updated = await apiFetch<Preferences>(`${basePath}/preferences/me`, {
      method: "PATCH",
      body: patch,
    })
    setPreferences(updated)
  }

  async function markAllRead() {
    await markRead()
  }

  async function markRead(item?: NotificationItem) {
    if (markingRef.current) return false
    markingRef.current = true
    setMarking(true)
    setMessage("")
    ++loadVersion.current
    try {
      const result = await apiFetch<{ ok: boolean }>(item ? `${basePath}/${item.id}/read` : `${basePath}/read-all`, { method: item ? "PATCH" : "POST" })
      if (!result?.ok) throw new Error("Notification could not be marked as read.")
      ++loadVersion.current
      setItems((current) => current
        .map((row) => !item || row.id === item.id ? { ...row, readAt: row.readAt || new Date().toISOString() } : row)
        .filter((row) => readFilter !== "unread" || !row.readAt))
      setSummary((current) => ({ ...current, unread: item ? Math.max(0, current.unread - (item.readAt ? 0 : 1)) : 0 }))
      // Reconcile notifications arriving concurrently, without blocking the UI.
      void load()
      return true
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Notifications could not be marked as read. Please retry.")
      return false
    } finally {
      markingRef.current = false
      setMarking(false)
    }
  }

  async function openItem(item: NotificationItem) {
    if (!item.readAt && !await markRead(item)) return
    if (item.actionUrl && /^\/(admin|app)(\/|$)/.test(item.actionUrl)) {
      setOpen(false)
      router.push(item.actionUrl)
    }
  }

  return (
    <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) void load() }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Open notifications">
          {summary.unread ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          {summary.unread ? (
            <span className="absolute right-0 top-0 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold text-white">
              {summary.unread > 99 ? "99+" : summary.unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(94vw,420px)] p-0">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <div className="font-semibold">Notifications</div>
            <div className="text-xs text-muted-foreground">
              {audience === "client" ? "Lead replies, appointments, and action items" : "Business updates and action items"}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void markAllRead()} disabled={marking || !summary.unread}>
            <CheckCheck className="mr-1 h-4 w-4" /> Mark all as read
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2 border-b p-3">
          <select aria-label="Filter notifications by category" className="h-9 min-w-0 rounded-md border bg-background px-2 text-xs" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>
            {["leads", "clients", "onboarding", "billing", "tasks", "support", "integrations", "system"].map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select aria-label="Filter notifications by severity" className="h-9 min-w-0 rounded-md border bg-background px-2 text-xs" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
            <option value="all">All severity</option>
            {["info", "success", "warning", "critical"].map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
          <select aria-label="Filter notifications by read status" className="h-9 min-w-0 rounded-md border bg-background px-2 text-xs" value={readFilter} onChange={(event) => setReadFilter(event.target.value)}>
            <option value="all">All status</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
        </div>
        <ScrollArea className="h-80">
          <div className="divide-y">
            {items.map((item) => (
              <div
                key={item.id}
                className={`w-full p-4 text-left hover:bg-muted/60 ${item.readAt ? "opacity-70" : "bg-primary/5"}`}
              >
                <button type="button" onClick={() => void openItem(item)} disabled={marking} className="flex w-full items-start gap-3 text-left">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    item.severity === "critical" ? "bg-red-500" :
                    item.severity === "warning" ? "bg-amber-500" :
                    item.severity === "success" ? "bg-emerald-500" : "bg-blue-500"
                  }`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.message}</span>
                    <span className="mt-2 block text-[11px] text-muted-foreground">
                      {item.category} · {item.severity} · {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </span>
                </button>
                {!item.readAt ? <Button size="sm" variant="ghost" disabled={marking} onClick={() => void markRead(item)} aria-label={`Mark ${item.title} as read`}>Mark as read</Button> : null}
              </div>
            ))}
            {!items.length ? <div className="p-8 text-center text-sm text-muted-foreground">No notifications match these filters.</div> : null}
          </div>
        </ScrollArea>
        <div className="space-y-3 border-t p-4">
          {/* Device push is disabled product-wide: notifications are email + in-app only.
              The backend push infrastructure remains for now; only the customer-facing
              push UI (connect device, phone alerts, device check, VAPID status,
              subscriptions, push categories, quiet hours) is hidden. */}
          {preferences ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-3">
                <div><div className="text-sm font-medium">In-app notifications</div><div className="text-xs text-muted-foreground">Show updates in this notification center.</div></div>
                <Switch checked={preferences.inAppEnabled} onCheckedChange={(checked) => void updatePreferences({ inAppEnabled: checked })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-3">
                <div><div className="text-sm font-medium">Email notifications</div><div className="text-xs text-muted-foreground">Receive important updates by email.</div></div>
                <Switch checked={preferences.emailEnabled !== false} onCheckedChange={(checked) => void updatePreferences({ emailEnabled: checked })} />
              </div>
            </div>
          ) : null}
          {message ? <p role="status" className="rounded-md border p-2 text-xs">{message}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
