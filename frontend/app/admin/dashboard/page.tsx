"use client"

import { type FormEvent, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

type ClientSetup = {
  tenant: Tenant & { trialEndsAt: string | null }
  owner: {
    id: string
    email: string
    role: string
    isEmailVerified: boolean
  }
  temporaryPassword: string
  verifyLink: string
  verificationEmailSent: boolean
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
  const [businessName, setBusinessName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientSetup, setClientSetup] = useState<ClientSetup | null>(null)

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

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      setCreatingClient(true)
      setError("")
      const result = await apiFetch<ClientSetup>("/admin/tenants", {
        method: "POST",
        body: { businessName, ownerEmail },
      })
      setClientSetup(result)
      setTenants((current) => [result.tenant, ...current])
      setBusinessName("")
      setOwnerEmail("")
    } catch (error: unknown) {
      setError(errorMessage(error, "Client workspace could not be created"))
    } finally {
      setCreatingClient(false)
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setError("Copy failed. Select the value and copy it manually.")
    }
  }

  if (loading) return <div className="p-6">Loading admin dashboard...</div>

  return (
    <div className="space-y-8 p-6">

      {error ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError("")}>Dismiss</Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create a client workspace</CardTitle>
          <p className="text-sm text-muted-foreground">
            Creates a 14-day trial and the client&apos;s first owner account. Share the temporary password separately from the verification email.
          </p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={createClient}>
            <label className="space-y-2 text-sm font-medium">
              Business name
              <Input
                required
                minLength={2}
                maxLength={120}
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="Lakeview Realty Group"
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              Owner email
              <Input
                required
                type="email"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                placeholder="broker@example.com"
              />
            </label>
            <Button type="submit" disabled={creatingClient}>
              {creatingClient ? "Creating…" : "Create client"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {clientSetup ? (
        <Card className="border-emerald-500/40">
          <CardHeader>
            <CardTitle>Client workspace created</CardTitle>
            <p className="text-sm text-muted-foreground">
              These credentials are displayed only in this browser session. Store them securely, then send the password through a separate channel.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <SetupValue
              label="Owner email"
              value={clientSetup.owner.email}
              onCopy={() => copyText(clientSetup.owner.email)}
            />
            <SetupValue
              label="Temporary password"
              value={clientSetup.temporaryPassword}
              onCopy={() => copyText(clientSetup.temporaryPassword)}
            />
            <SetupValue
              label="Verification link"
              value={clientSetup.verifyLink}
              onCopy={() => copyText(clientSetup.verifyLink)}
            />
            <div className="rounded-md bg-muted p-3 text-sm">
              {clientSetup.verificationEmailSent
                ? "Verification email sent. Share only the temporary password with the client through a separate channel."
                : "Email delivery is not connected. Send the verification link and temporary password separately, or connect SendGrid before onboarding the next client."}
            </div>
            <Button variant="outline" onClick={() => setClientSetup(null)}>Done</Button>
          </CardContent>
        </Card>
      ) : null}

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

function SetupValue({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => void
}) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">{value}</code>
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>Copy</Button>
      </div>
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
