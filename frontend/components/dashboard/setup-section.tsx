"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Circle, ClipboardCheck } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ReadinessItem = { key: string; label: string; passed: boolean; required: boolean }
type Readiness = {
  state: string
  ready: boolean
  blockers: ReadinessItem[]
  required: ReadinessItem[]
  lastUpdatedAt: string
}

export function DashboardSetupSection() {
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    void apiFetch<Readiness>("/onboarding/readiness")
      .then(setReadiness)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Readiness unavailable"))
  }, [])

  const passed = readiness?.required.filter((item) => item.passed).length || 0
  const total = readiness?.required.length || 0

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Launch readiness</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Based on billing, approved templates, consent policy, provider tests, and recorded launch evidence.
          </p>
        </div>
        <Badge variant={readiness?.ready ? "default" : "secondary"}>
          {readiness?.ready ? "Ready for operator activation" : `${passed} of ${total} passed`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!readiness && !error ? <p className="text-sm text-muted-foreground">Calculating required conditions…</p> : null}
        {readiness ? (
          <>
            <div className="grid gap-2 md:grid-cols-2">
              {readiness.required.slice(0, 8).map((item) => (
                <div key={item.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                  {item.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            {readiness.blockers.length ? (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                <span>{readiness.blockers.length} required item(s) still block activation. Automations remain off.</span>
              </div>
            ) : null}
            <Button asChild><Link href="/app/onboarding">Review all setup evidence</Link></Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
