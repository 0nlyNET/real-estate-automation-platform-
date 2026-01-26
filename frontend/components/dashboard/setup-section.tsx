"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { apiFetch } from "@/lib/api"
import { ChevronDown, CheckCircle2, Circle, Sparkles, ArrowRight } from "lucide-react"

type TenantSettings = {
  tenantId: string
  timeZone: string
  quietHoursStart: string
  quietHoursEnd: string
  bookingLink?: string
  automationsEnabled: boolean
}

type StatsOverview = {
  leadsTotal: number
  messagesTotal: number
}

type SequencesResp = {
  sequences: Array<{ id: string }>
}

function isValidHttpUrl(v: string) {
  try {
    const u = new URL(v)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

function ProgressPill({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="text-xs text-muted-foreground">
        {done} of {total}
      </div>
      <div className="h-2 w-28 overflow-hidden rounded-full bg-border">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function DashboardSetupSection() {
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)

  const [settings, setSettings] = useState<TenantSettings | null>(null)
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const [sequencesCount, setSequencesCount] = useState<number>(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [s, st, seq] = await Promise.all([
          apiFetch<TenantSettings>("/settings/tenant").catch(() => null),
          apiFetch<StatsOverview>("/stats/overview").catch(() => ({ leadsTotal: 0, messagesTotal: 0 })),
          apiFetch<SequencesResp>("/sequences", { method: "GET" }).catch(() => ({ sequences: [] })),
        ])

        if (!alive) return
        setSettings(s)
        setStats(st)
        setSequencesCount(Array.isArray((seq as any)?.sequences) ? (seq as any).sequences.length : 0)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const items = useMemo(() => {
    const tzDone = Boolean((settings?.timeZone || "").trim())
    const quietDone = Boolean((settings?.quietHoursStart || "").trim() && (settings?.quietHoursEnd || "").trim())
    const autoDone = Boolean(settings?.automationsEnabled)
    const bookingDone = Boolean((settings?.bookingLink || "").trim() && isValidHttpUrl((settings?.bookingLink || "").trim()))
    const leadsDone = (stats?.leadsTotal || 0) > 0
    const seqDone = sequencesCount > 0

    return [
      {
        key: "quiet",
        title: "Configure quiet hours",
        desc: "Prevents messages sending late and keeps delivery compliant.",
        done: quietDone && tzDone,
        ctaHref: "/app/settings",
        cta: "Open settings",
      },
      {
        key: "automations",
        title: "Enable automations",
        desc: "Lets sequences send follow-ups automatically when leads come in.",
        done: autoDone,
        ctaHref: "/app/settings",
        cta: "Review toggle",
      },
      {
        key: "lead",
        title: "Add your first lead",
        desc: "Once you have one lead, you can verify inbox, templates, and automations.",
        done: leadsDone,
        ctaHref: "/app/leads",
        cta: "View leads",
      },
      {
        key: "sequence",
        title: "Create your first automation",
        desc: "A sequence is your follow-up engine. Start with a simple 3-step outreach.",
        done: seqDone,
        ctaHref: "/app/automations",
        cta: "Create automation",
      },
      {
        key: "messaging",
        title: "Connect messaging provider",
        desc: "Required for SMS sending and inbound replies in the inbox.",
        done: false,
        ctaHref: "/app/integrations",
        cta: "Open integrations",
        soon: true,
      },
      {
        key: "email",
        title: "Connect email provider",
        desc: "Required for email sending from templates and automations.",
        done: false,
        ctaHref: "/app/integrations",
        cta: "Open integrations",
        soon: true,
      },
      {
        key: "booking",
        title: "Add a booking link (recommended)",
        desc: "Turns replies into booked calls without back-and-forth.",
        done: bookingDone,
        ctaHref: "/app/settings",
        cta: "Add link",
        optional: true,
      },
    ]
  }, [settings, stats, sequencesCount])

  const progress = useMemo(() => {
    const total = items.filter((i) => !i.optional && !i.soon).length
    const done = items.filter((i) => !i.optional && !i.soon && i.done).length
    return { done, total }
  }, [items])

  useEffect(() => {
    if (loading) return
    if (progress.total > 0 && progress.done >= progress.total) {
      setOpen(false)
    } else {
      setOpen(true)
    }
  }, [loading, progress.done, progress.total])

  if (loading) {
    return (
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Setup
            </CardTitle>
            <div className="text-sm text-muted-foreground">Loading checklist...</div>
          </div>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    )
  }

  const showNudge = progress.total > 0 && progress.done >= Math.max(0, progress.total - 2) && progress.done < progress.total

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Setup
              {progress.total > 0 && progress.done >= progress.total ? (
                <Badge variant="secondary" className="ml-2">
                  Complete
                </Badge>
              ) : null}
            </CardTitle>

            <div className="text-sm text-muted-foreground">
              {progress.total > 0 && progress.done >= progress.total
                ? "Your workspace is ready. You can collapse this anytime."
                : "Finish setup so the system can send and receive messages correctly."}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ProgressPill done={progress.done} total={progress.total} />
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                {open ? "Collapse" : "Expand"}
                <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3">
            {showNudge ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
                <div className="font-medium">Almost done</div>
                <div className="text-muted-foreground">
                  Finish setup to avoid missed sends and get full inbox visibility.
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              {items.map((i) => (
                <div
                  key={i.key}
                  className="rounded-lg border border-border/60 bg-background/40 p-4 transition hover:border-border"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {i.done ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div className="font-medium">{i.title}</div>
                        {i.optional ? (
                          <Badge variant="secondary" className="ml-1">
                            Optional
                          </Badge>
                        ) : null}
                        {i.soon ? (
                          <Badge variant="secondary" className="ml-1">
                            Coming soon
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-sm text-muted-foreground">{i.desc}</div>
                    </div>

                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link href={i.ctaHref}>
                        {i.cta} <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
