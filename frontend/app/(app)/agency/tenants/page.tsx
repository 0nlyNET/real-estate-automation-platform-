"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch, ApiError } from "@/lib/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/app-shell/app-shell"

type TenantRow = {
  id: string
  name: string
  plan: string
  status: string
  onboardingStatus: string
  integrations: {
    twilioConnected: boolean
    sendgridConnected: boolean
    bookingLinkSet: boolean
  }
  billing: {
    plan: string
    status: string
    currentPeriodEnd: string | null
  }
  lastActivityAt: string | null
}

export default function AgencyTenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<string | null>(null)

  const getErrorMessage = (apiError: ApiError) => {
    if (apiError?.status === 401) {
      return "You are not logged in. Go to /login."
    }
    if (apiError?.status === 403) {
      return "This account is not an agency admin."
    }
    if (apiError?.status === 0) {
      return "Network/CORS issue. Check NEXT_PUBLIC_API_URL and FRONTEND_URL."
    }
    if (apiError?.status) {
      return `${apiError.status}: ${apiError.message}`
    }
    return "Unable to load tenants"
  }

  useEffect(() => {
    const load = async () => {
      try {
        const me = await apiFetch<{ role?: string }>("/me", { auth: true })
        const resolvedRole = me?.role || "USER"
        setRole(resolvedRole)
        if (resolvedRole !== "AGENCY_ADMIN") {
          setError("This account is not an agency admin.")
          return
        }

        const data = await apiFetch<TenantRow[]>("/agency/tenants", { auth: true })
        setTenants(data)
      } catch (err) {
        setError(getErrorMessage(err as ApiError))
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  return (
    <AppShell>
      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Tenant directory</h1>
              <p className="mt-2 text-sm text-muted-foreground">Monitor onboarding and system health across clients.</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/agency">Back to agency</Link>
            </Button>
          </div>

          {loading && <p className="mt-6 text-sm text-muted-foreground">Loading tenants…</p>}
          {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

          {!loading && !error && role === "AGENCY_ADMIN" && (
            <Card className="mt-6 border-border bg-card">
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Tenant</th>
                        <th className="px-4 py-3">Plan</th>
                        <th className="px-4 py-3">Onboarding</th>
                        <th className="px-4 py-3">Integrations</th>
                        <th className="px-4 py-3">Billing</th>
                        <th className="px-4 py-3">Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenants.map((tenant) => (
                        <tr key={tenant.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <Link className="text-primary underline" href={`/agency/tenants/${tenant.id}`}>
                              {tenant.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            {tenant.plan} ({tenant.status})
                          </td>
                          <td className="px-4 py-3 capitalize">{tenant.onboardingStatus.replace("_", " ")}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            Twilio: {tenant.integrations.twilioConnected ? "connected" : "missing"}
                            <br />
                            SendGrid: {tenant.integrations.sendgridConnected ? "connected" : "missing"}
                            <br />
                            Booking link: {tenant.integrations.bookingLinkSet ? "set" : "missing"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {tenant.billing.plan} ({tenant.billing.status})
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </AppShell>
  )
}
