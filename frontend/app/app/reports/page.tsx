"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function ReportsPage() {
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const d = await apiFetch("/stats/overview")
        if (!mounted) return
        setData(d)
      } catch (e: any) {
        if (!mounted) return
        setErr(e?.message || "Failed to load stats")
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  return (
    <PageShell title="Reporting" subtitle="Agent metrics and speed-to-lead performance.">
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {err ? <div className="text-sm text-red-500">{err}</div> : null}
          {!data ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
          {data ? <pre className="text-xs overflow-x-auto rounded bg-muted p-3">{JSON.stringify(data, null, 2)}</pre> : null}
        </CardContent>
      </Card>
    </PageShell>
  )
}
