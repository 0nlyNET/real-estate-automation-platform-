"use client"

import { useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"

export default function UpgradePage() {
  const [interval, setInterval] = useState<"month" | "year">("month")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState("")

  async function checkout(plan: "pro" | "teams") {
    try {
      setLoading(plan)
      setError("")
      const result = await apiFetch<{ url: string }>("/billing/checkout-session", { method: "POST", body: { plan, interval } })
      window.location.href = result.url
    } catch (e: any) {
      setError(e?.message || "Checkout could not be started")
      setLoading("")
    }
  }

  return (
    <PageShell title="Upgrade" subtitle="Payment is completed securely on Stripe.">
      {error ? <div className="text-sm text-red-500">{error}</div> : null}
      <div className="flex gap-2"><Button variant={interval === "month" ? "default" : "outline"} onClick={() => setInterval("month")}>Monthly</Button><Button variant={interval === "year" ? "default" : "outline"} onClick={() => setInterval("year")}>Annual</Button></div>
      <div className="grid gap-4 md:grid-cols-2">
        <PlanCard name="Pro" description="Core lead response and follow-up for a single-user workspace." action={() => checkout("pro")} loading={loading === "pro"} />
        <PlanCard name="Teams" description="Team users, routing rules, assignments, and shared operations." action={() => checkout("teams")} loading={loading === "teams"} />
      </div>
    </PageShell>
  )
}

function PlanCard({ name, description, action, loading }: { name: string; description: string; action: () => void; loading: boolean }) {
  return <Card><CardHeader><CardTitle>{name}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{description}</p><Button onClick={action} disabled={loading}>{loading ? "Opening Stripe..." : `Choose ${name}`}</Button></CardContent></Card>
}
