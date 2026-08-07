"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Circle, ClipboardCheck } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ReadinessItem = {
  key: string
  label: string
  passed: boolean
  required: boolean
  responsibleParty: "client" | "jayden" | "provider" | "platform"
  statusMessage: string
  nextAction?: string | null
}
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

  const clientItems = readiness?.required.filter((item) => item.responsibleParty === "client") || []
  const passed = clientItems.filter((item) => item.passed).length
  const total = clientItems.length
  const nextClientAction = readiness?.blockers.find((item) => item.responsibleParty === "client")

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Your setup</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete your information and connections. RealtyTechAI handles the technical tests and final launch review.
          </p>
        </div>
        <Badge variant={readiness?.ready ? "default" : "secondary"}>
          {readiness?.ready ? "Ready for final activation" : `${passed} of ${total} checks complete`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!readiness && !error ? <p className="text-sm text-muted-foreground">Calculating required conditions…</p> : null}
        {readiness ? (
          <>
            <div className="grid gap-2 md:grid-cols-2">
              {clientItems.slice(0, 8).map((item) => (
                <div key={item.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                  {item.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                  <span><span className="block">{item.label}</span>{!item.passed && item.nextAction ? <span className="mt-1 block text-xs text-muted-foreground">{item.nextAction}</span> : null}</span>
                </div>
              ))}
            </div>
            {readiness.blockers.length ? (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                <span>{nextClientAction?.nextAction || `${readiness.blockers.length} launch check(s) remain. RealtyTechAI will handle technical tests and provider review; nothing goes live early.`}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2"><Button asChild><Link href="/app/onboarding">Continue setup</Link></Button><Button asChild variant="outline"><Link href="/app/integrations">Review connections</Link></Button></div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
