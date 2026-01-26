"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { apiFetch } from "@/lib/api"
import { Inbox, ArrowRight } from "lucide-react"

type Thread = {
  leadId: string
  leadName: string | null
  leadEmail: string | null
  leadPhone: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadCount: number
}

function nameFor(t: Thread) {
  return t.leadName || t.leadEmail || t.leadPhone || "Lead"
}

export function DashboardInboxPreview() {
  const [loading, setLoading] = useState(true)
  const [threads, setThreads] = useState<Thread[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await apiFetch<any>("/messaging/threads?take=5&skip=0")
        if (!alive) return
        const rows: Thread[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
        setThreads(rows)
      } catch {
        if (!alive) return
        setThreads([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-primary" />
          Inbox
        </CardTitle>
        <Button asChild variant="outline" size="sm" className="h-8">
          <Link href="/app/inbox">
            Open <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : threads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-5">
            <div className="text-sm font-medium">No conversations yet</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Connect lead sources and messaging to start receiving replies here.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm" className="h-8">
                <Link href="/app/integrations">Connect integrations</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8">
                <Link href="/app/leads">View leads</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {threads.map((t) => (
              <Link
                key={t.leadId}
                href="/app/inbox"
                className="block rounded-lg border border-border/60 bg-background/40 p-3 transition hover:border-border"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{nameFor(t)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.lastMessagePreview || "No messages"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.unreadCount ? <Badge>{t.unreadCount}</Badge> : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
