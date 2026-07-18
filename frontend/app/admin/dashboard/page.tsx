"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { startImpersonation } from "@/lib/impersonation"

type Overview = {
  totalClients: number
  active: number
  trialing: number
  pastDue: number
  canceled: number
}

type SystemHealth = {
  totalMessages24h: number
  failedMessages24h: number
  dbConnected: boolean
}

type Tenant = {
  id: string
  name: string
  plan: string
  status: string
}

type TenantUser = {
  id: string
  tenantId: string
  email: string
  role: string
  isActive: boolean
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])

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
      } catch (error: unknown) {
        if (!alive) return
        setError(errorMessage(error, "Failed to load admin data"))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function manageTenant(tenant: Tenant) {
    try {
      setError("")
      setSelectedTenant(tenant)
      setTenantUsers(await apiFetch<TenantUser[]>(`/admin/tenants/${tenant.id}/users`))
    } catch (error: unknown) {
      setError(errorMessage(error, "Failed to load tenant users"))
    }
  }

  async function impersonate(userId: string) {
    try {
      const result = await apiFetch<{ accessToken: string; user: TenantUser }>("/admin/impersonate", {
        method: "POST",
        body: { userId },
      })
      startImpersonation(result.accessToken, result.user)
      window.location.assign("/app/dashboard")
    } catch (error: unknown) {
      setError(errorMessage(error, "Impersonation failed"))
    }
  }

  if (loading) return <div className="p-6">Loading admin dashboard...</div>
  if (error) return <div className="p-6 text-red-500">{error}</div>

  return (
    <div className="space-y-8 p-6">

      {/* REVENUE + RISK */}
      <div>
        <div className="text-2xl font-semibold mb-4">Client & Risk Overview</div>
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          <StatCard title="Total Clients" value={overview?.totalClients} />
          <StatCard title="Active" value={overview?.active} />
          <StatCard title="Trial" value={overview?.trialing} />
          <StatCard title="Past Due" value={overview?.pastDue} />
          <StatCard title="Canceled" value={overview?.canceled} />
        </div>
      </div>

      {/* SYSTEM HEALTH */}
      <div>
        <div className="text-2xl font-semibold mb-4">System Health</div>
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard title="Messages (24h)" value={health?.totalMessages24h} />
          <StatCard title="Failed (24h)" value={health?.failedMessages24h} />
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
                <Button variant="outline" onClick={() => manageTenant(t)}>Manage</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {selectedTenant ? (
        <Card>
          <CardHeader><CardTitle>{selectedTenant.name} users</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {tenantUsers.map((user) => (
              <div key={user.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{user.email}</div>
                  <div className="text-sm text-muted-foreground">{user.role} · {user.isActive ? "active" : "inactive"}</div>
                </div>
                <Button disabled={!user.isActive} onClick={() => impersonate(user.id)}>Open workspace</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

    </div>
  )
}

function StatCard({
  title,
  value,
}: {
  title: string
  value: string | number | null | undefined
}) {
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
