"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api"
import { Users, ArrowRight } from "lucide-react"

type Lead = {
  id: string
  fullName?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
  status?: string | null
  createdAt?: string | null
}

function labelFor(l: Lead) {
  return l.fullName || l.email || l.phone || "Lead"
}

export function DashboardLeadsPreview() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Lead[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await apiFetch<Lead[]>("/leads?take=5&skip=0")
        if (!alive) return
        setRows(Array.isArray(data) ? data : [])
      } catch {
        if (!alive) return
        setRows([])
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
          <Users className="h-4 w-4 text-primary" />
          Leads
        </CardTitle>
        <Button asChild variant="outline" size="sm" className="h-8">
          <Link href="/app/leads">
            View <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-5">
            <div className="text-sm font-medium">No leads yet</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Connect Facebook Lead Ads or use the intake endpoint to start capturing leads.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm" className="h-8">
                <Link href="/app/integrations">Connect sources</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8">
                <Link href="/app/reports">View reporting</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((l) => (
              <div
                key={l.id}
                className="rounded-lg border border-border/60 bg-background/40 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{labelFor(l)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {l.source ? `Source: ${l.source}` : "Source: unknown"}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {l.createdAt ? new Date(l.createdAt).toLocaleDateString() : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
