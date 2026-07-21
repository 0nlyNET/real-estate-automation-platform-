"use client"

import { useCallback, useEffect, useState } from "react"
import { Bell, BellRing, CheckCheck, Smartphone } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

type Summary = { unread: number; activeDevices: number; pushConfigured: boolean }
type Preferences = {
  pushEnabled: boolean
  privacyMode: boolean
  inAppEnabled: boolean
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  timezone: string
  categorySettings: Record<string, boolean>
  severitySettings: Record<string, boolean>
}

function applicationKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}

export function NotificationCenter({ audience = "admin" }: { audience?: "admin" | "client" }) {
  const basePath = audience === "client" ? "/notifications" : "/admin/notifications"
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [summary, setSummary] = useState<Summary>({ unread: 0, activeDevices: 0, pushConfigured: false })
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [thisDeviceEnabled, setThisDeviceEnabled] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [severityFilter, setSeverityFilter] = useState("all")
  const [readFilter, setReadFilter] = useState("all")

  const loadDeviceState = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return setThisDeviceEnabled(false)
    const registration = await navigator.serviceWorker.getRegistration("/")
    const subscription = await registration?.pushManager.getSubscription()
    setThisDeviceEnabled(Boolean(subscription))
  }, [])

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ take: "30" })
      if (categoryFilter !== "all") query.set("category", categoryFilter)
      if (severityFilter !== "all") query.set("severity", severityFilter)
      if (readFilter !== "all") query.set("read", readFilter)
      const [nextItems, nextSummary, nextPreferences] = await Promise.all([
        apiFetch<NotificationItem[]>(`${basePath}?${query.toString()}`),
        apiFetch<Summary>(`${basePath}/summary`),
        apiFetch<Preferences>(`${basePath}/preferences/me`),
        loadDeviceState(),
      ])
      setItems(nextItems)
      setSummary(nextSummary)
      setPreferences(nextPreferences)
    } catch {
      setMessage("Notifications could not be loaded.")
    }
  }, [basePath, categoryFilter, loadDeviceState, readFilter, severityFilter])

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

  async function enableDevicePush() {
    setBusy(true)
    setMessage("")
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("This browser does not support web push notifications.")
      }
      const config = await apiFetch<{ configured: boolean; publicKey: string | null }>(
        `${basePath}/push/config`,
      )
      if (!config.configured || !config.publicKey) {
        throw new Error("Phone alerts need VAPID keys in Railway before they can be enabled.")
      }
      const permission = await Notification.requestPermission()
      if (permission !== "granted") throw new Error("Notification permission was not granted.")
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationKey(config.publicKey),
      })
      const payload = subscription.toJSON()
      await apiFetch(`${basePath}/push/subscriptions`, {
        method: "POST",
        body: {
          endpoint: subscription.endpoint,
          keys: payload.keys,
          deviceLabel: navigator.userAgent.includes("iPhone") ? "iPhone" : "Browser device",
        },
      })
      await updatePreferences({ pushEnabled: true })
      setThisDeviceEnabled(true)
      setMessage("Phone alerts are enabled on this device.")
      await load()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Phone alerts could not be enabled.")
    } finally {
      setBusy(false)
    }
  }

  async function disableDevicePush() {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration("/")
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await apiFetch(`${basePath}/push/subscriptions`, {
          method: "DELETE",
          body: { endpoint: subscription.endpoint },
        })
        await subscription.unsubscribe()
      }
      await updatePreferences({ pushEnabled: summary.activeDevices > 1 })
      setThisDeviceEnabled(false)
      setMessage("Phone alerts are disconnected from this device.")
      await load()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Phone alerts could not be disabled.")
    } finally {
      setBusy(false)
    }
  }

  async function markAllRead() {
    await apiFetch(`${basePath}/read-all`, { method: "POST" })
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
    setSummary((current) => ({ ...current, unread: 0 }))
  }

  async function openItem(item: NotificationItem) {
    if (!item.readAt) await apiFetch(`${basePath}/${item.id}/read`, { method: "PATCH" })
    if (item.actionUrl?.startsWith("/admin") || item.actionUrl?.startsWith("/app")) window.location.assign(item.actionUrl)
    else await load()
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
          <Button variant="ghost" size="sm" onClick={() => void markAllRead()} disabled={!summary.unread}>
            <CheckCheck className="mr-1 h-4 w-4" /> Mark read
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
              <button
                key={item.id}
                type="button"
                onClick={() => void openItem(item)}
                className={`w-full p-4 text-left hover:bg-muted/60 ${item.readAt ? "opacity-70" : "bg-primary/5"}`}
              >
                <div className="flex items-start gap-3">
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
                </div>
              </button>
            ))}
            {!items.length ? <div className="p-8 text-center text-sm text-muted-foreground">No notifications match these filters.</div> : null}
          </div>
        </ScrollArea>
        <div className="space-y-3 border-t p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium"><Smartphone className="h-4 w-4" /> Phone alerts</div>
              <div className="text-xs text-muted-foreground">
                {summary.activeDevices ? `${summary.activeDevices} connected device${summary.activeDevices === 1 ? "" : "s"}` : "No device connected"}
              </div>
            </div>
            <Button size="sm" variant={thisDeviceEnabled ? "outline" : "default"} disabled={busy} onClick={() => void (thisDeviceEnabled ? disableDevicePush() : enableDevicePush())}>
              {thisDeviceEnabled ? "Disconnect this device" : busy ? "Connecting…" : "Connect this device"}
            </Button>
          </div>
          {preferences ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-3">
                <div><div className="text-sm font-medium">In-app notifications</div><div className="text-xs text-muted-foreground">Show updates in this notification center.</div></div>
                <Switch checked={preferences.inAppEnabled} onCheckedChange={(checked) => void updatePreferences({ inAppEnabled: checked })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-3">
                <div><div className="text-sm font-medium">Device alerts</div><div className="text-xs text-muted-foreground">Pause or resume alerts on all connected devices.</div></div>
                <Switch checked={preferences.pushEnabled} onCheckedChange={(checked) => void updatePreferences({ pushEnabled: checked })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-3">
                <div><div className="text-sm font-medium">Private lock-screen text</div><div className="text-xs text-muted-foreground">Hide client and billing details in device alerts.</div></div>
                <Switch checked={preferences.privacyMode} onCheckedChange={(checked) => void updatePreferences({ privacyMode: checked })} />
              </div>
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">Choose which alerts reach this device</summary>
                <div className="mt-3 space-y-3">
                  {[
                    ["leads", "New leads"],
                    ["clients", "Client updates"],
                    ["onboarding", "Client onboarding"],
                    ["tasks", "Tasks"],
                    ["support", "Support"],
                    ["integrations", "Connections"],
                    ["billing", "Billing"],
                    ["system", "System health"],
                  ].map(([key, title]) => <div key={key} className="flex items-center justify-between"><span>{title}</span><Switch checked={preferences.categorySettings?.[key] !== false} onCheckedChange={(checked) => void updatePreferences({ categorySettings: { [key]: checked } } as Partial<Preferences>)} /></div>)}
                  <div className="flex items-center justify-between"><span>Routine information</span><Switch checked={preferences.severitySettings?.info === true} onCheckedChange={(checked) => void updatePreferences({ severitySettings: { info: checked } } as Partial<Preferences>)} /></div>
                  <div className="flex items-center justify-between"><span>Successful events</span><Switch checked={preferences.severitySettings?.success !== false} onCheckedChange={(checked) => void updatePreferences({ severitySettings: { success: checked } } as Partial<Preferences>)} /></div>
                  <div className="flex items-center justify-between"><span>Warnings</span><Switch checked={preferences.severitySettings?.warning !== false} onCheckedChange={(checked) => void updatePreferences({ severitySettings: { warning: checked } } as Partial<Preferences>)} /></div>
                  <p className="text-xs text-muted-foreground">Critical alerts remain enabled for safety. Quiet hours pause noncritical device alerts.</p>
                </div>
              </details>
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">Quiet hours</summary>
                <div className="mt-3 space-y-3">
                  <div className="flex items-center justify-between"><span>Pause noncritical alerts</span><Switch checked={preferences.quietHoursEnabled} onCheckedChange={(checked) => void updatePreferences({ quietHoursEnabled: checked })} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-xs">Start<Input type="time" value={preferences.quietHoursStart || "21:00"} onChange={(event) => void updatePreferences({ quietHoursStart: event.target.value })} /></label>
                    <label className="space-y-1 text-xs">End<Input type="time" value={preferences.quietHoursEnd || "08:00"} onChange={(event) => void updatePreferences({ quietHoursEnd: event.target.value })} /></label>
                  </div>
                  <select aria-label="Quiet-hours timezone" className="h-9 w-full rounded-md border bg-background px-2 text-xs" value={preferences.timezone || "America/New_York"} onChange={(event) => void updatePreferences({ timezone: event.target.value })}>
                    <option value="America/New_York">Eastern time</option><option value="America/Chicago">Central time</option><option value="America/Denver">Mountain time</option><option value="America/Phoenix">Arizona time</option><option value="America/Los_Angeles">Pacific time</option><option value="Pacific/Honolulu">Hawaii time</option>
                  </select>
                </div>
              </details>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">On iPhone, add RealtyTechAI to your Home Screen first, then open it there and enable alerts.</p>
          {message ? <p className="rounded-md border p-2 text-xs">{message}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
