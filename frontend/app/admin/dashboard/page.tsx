"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Overview = {
  totalClients: number
  active: number
  trialing: number
  pastDue: number
  canceled: number
  monthlyRevenueEstimate: number
}

type SystemHealth = {
  totalApiCalls24h: number
  totalMessages24h: number
  failedMessages24h: number
  twilioErrorRate: number
  sendgridErrorRate: number
  dbConnected: boolean
}

type Tenant = {
  id: string
  name: string
  plan: string
  status: string
}

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [o, h, t] = await Promise.all([
          apiFetch<Overview>("/admin/overview"),
          apiFetch<SystemHealth>("/admin/system-health"),
          apiFetch<Tenant[]>("/admin/tenants"),
        ])

        if (!alive) return
        setOverview(o)
        setHealth(h)
        setTenants(t)
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || "Failed to load admin data")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (loading) return <div className="p-6">Loading admin dashboard...</div>
  if (error) return <div className="p-6 text-red-500">{error}</div>

  return (
    <div className="space-y-8 p-6">

      {/* REVENUE + RISK */}
      <div>
        <div className="text-2xl font-semibold mb-4">Revenue & Risk Overview</div>
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <StatCard title="Total Clients" value={overview?.totalClients} />
          <StatCard title="Active" value={overview?.active} />
          <StatCard title="Trial" value={overview?.trialing} />
          <StatCard title="Past Due" value={overview?.pastDue} />
          <StatCard title="Canceled" value={overview?.canceled} />
          <StatCard title="Est. MRR" value={`$${overview?.monthlyRevenueEstimate}`} />
        </div>
      </div>

      {/* SYSTEM HEALTH */}
      <div>
        <div className="text-2xl font-semibold mb-4">System Health</div>
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard title="Messages (24h)" value={health?.totalMessages24h} />
          <StatCard title="Failed (24h)" value={health?.failedMessages24h} />
          <StatCard title="Twilio Error Rate" value={`${health?.twilioErrorRate}`} />
          <StatCard title="SendGrid Error Rate" value={`${health?.sendgridErrorRate}`} />
          <StatCard title="DB Connected" value={health?.dbConnected ? "Yes" : "No"} />
        </div>
      </div>

      {/* CLIENT LIST */}
      <div>
        <div className="text-2xl font-semibold mb-4">Clients</div>
        <Card>
          <CardContent className="space-y-3">
            {tenants.map((t) => (
              <div key={t.id} className="flex justify-between border p-3 rounded-md">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {t.plan} • {t.status}
                  </div>
                </div>
                <Button variant="outline">Manage</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

    </div>
  )
}

function StatCard({ title, value }: { title: string; value: any }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold">
        {value ?? "-"}
      </CardContent>
    </Card>
  )
}
