"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"
import { fetchMePlan, MePlan } from "@/lib/plan"

export default function BillingPage() {
  const [plan, setPlan] = useState<MePlan | null>(null)
  const [error, setError] = useState("")
  useEffect(() => { fetchMePlan().then(setPlan) }, [])

  async function portal() {
    try {
      const result = await apiFetch<{ url: string }>("/billing/portal-session", { method: "POST" })
      window.location.href = result.url
    } catch (e: any) { setError(e?.message || "Billing portal could not be opened") }
  }

  return (
    <PageShell title="Billing" subtitle="Manage your database-backed subscription state.">
      {error ? <div className="text-sm text-red-500">{error}</div> : null}
      <Card>
        <CardHeader><CardTitle>Current plan</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="text-2xl font-semibold capitalize">{plan?.plan || "Loading..."}</div>
          <div className="text-sm text-muted-foreground">Status: {plan?.status || "—"}</div>
          <div className="flex gap-2"><Button asChild><Link href="/app/billing/upgrade">Upgrade</Link></Button><Button variant="outline" onClick={portal}>Manage on Stripe</Button></div>
        </CardContent>
      </Card>
    </PageShell>
  )
}
