"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { apiFetch } from "@/lib/api"
import { Zap, ArrowRight } from "lucide-react"

type TenantSettings = {
  tenantId: string
  timeZone: string
  quietHoursStart: string
  quietHoursEnd: string
  automationsEnabled: boolean
}

type SequencesResp = {
  sequences: Array<{ id: string; active?: boolean | null }>
}

function prettyQuiet(start?: string, end?: string) {
  const s = (start || "").trim()
  const e = (end || "").trim()
  if (!s || !e) return "Not configured"
  return `${s} to ${e}`
}

export function DashboardAutomationHealth() {
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  const [seq, setSeq] = useState<SequencesResp | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [s, sequences] = await Promise.all([
          apiFetch<TenantSettings>("/settings/tenant").catch(() => null),
          apiFetch<SequencesResp>("/sequences", { method: "GET" }).catch(() => ({ sequences: [] })),
        ])
        if (!alive) return
        setSettings(s)
        setSeq(sequences)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const summary = useMemo(() => {
    const enabled = Boolean(settings?.automationsEnabled)
    const quiet = prettyQuiet(settings?.quietHoursStart, settings?.quietHoursEnd)
    const total = Array.isArray(seq?.sequences) ? seq!.sequences.length : 0
    const active = Array.isArray(seq?.sequences)
      ? seq!.sequences.filter((x: any) => x?.active !== false).length
      : 0

    return { enabled, quiet, total, active }
  }, [settings, seq])

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-primary" />
          Automation health
        </CardTitle>
        <Button asChild variant="outline" size="sm" className="h-8">
          <Link href="/app/automations">
            Manage <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-60" />
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-5 w-52" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={summary.enabled ? "default" : "secondary"}>
                {summary.enabled ? "Automations enabled" : "Automations disabled"}
              </Badge>
              <Badge variant="secondary">Quiet hours: {summary.quiet}</Badge>
              <Badge variant="secondary">
                Sequences: {summary.active}/{summary.total}
              </Badge>
            </div>

            {!summary.enabled ? (
              <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="text-sm font-medium">Automations are off</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Turn them on in Settings so sequences can send follow-ups.
                </div>
                <div className="mt-3">
                  <Button asChild size="sm" className="h-8">
                    <Link href="/app/settings">Enable in Settings</Link>
                  </Button>
                </div>
              </div>
            ) : summary.total === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4">
                <div className="text-sm font-medium">No sequences yet</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Create a simple follow-up sequence to start converting leads automatically.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" className="h-8">
                    <Link href="/app/automations">Create first automation</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <Link href="/app/templates">View templates</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="text-sm font-medium">System looks ready</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Quiet hours are respected and sequences can send when allowed.
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
