"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { apiFetch, ApiError } from "@/lib/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/app-shell/app-shell"

type TenantDetail = {
  id: string
  name: string
  plan: string
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  health: {
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
    onboardingStatus: string
  }
  recentFailures: Array<{
    id: string
    createdAt: string
    channel: string
    error: string
    leadName?: string
  }>
}

export default function AgencyTenantDetailPage() {
  const params = useParams()
  const tenantId = params.tenantId as string
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
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
    return "Unable to load tenant"
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

        const data = await apiFetch<TenantDetail>(`/agency/tenants/${tenantId}`, { auth: true })
        setTenant(data)
      } catch (err) {
        setError(getErrorMessage(err as ApiError))
      } finally {
        setLoading(false)
      }
    }

    if (tenantId) {
      load()
    }
  }, [tenantId])

  return (
    <AppShell>
      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Tenant detail</p>
              <h1 className="text-3xl font-bold text-foreground">{tenant?.name || "Loading…"}</h1>
            </div>
            <Button asChild variant="outline">
              <Link href="/agency/tenants">Back to tenants</Link>
            </Button>
          </div>

          {loading && <p className="mt-6 text-sm text-muted-foreground">Loading tenant…</p>}
          {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

          {tenant && role === "AGENCY_ADMIN" && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card className="border-border bg-card">
                <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Plan:</span> {tenant.plan} ({tenant.status})
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Onboarding:</span> {tenant.health.onboardingStatus}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Billing status:</span> {tenant.health.billing.status}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Last activity:</span>{" "}
                    {tenant.health.lastActivityAt ? new Date(tenant.health.lastActivityAt).toLocaleString() : "—"}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Integration health</p>
                  <p>Twilio: {tenant.health.integrations.twilioConnected ? "connected" : "missing"}</p>
                  <p>SendGrid: {tenant.health.integrations.sendgridConnected ? "connected" : "missing"}</p>
                  <p>Booking link: {tenant.health.integrations.bookingLinkSet ? "set" : "missing"}</p>
                </CardContent>
              </Card>

              <Card className="border-border bg-card lg:col-span-2">
                <CardContent className="space-y-4 p-6">
                  <div>
                    <p className="text-sm font-medium text-foreground">Recent message failures</p>
                    <p className="text-xs text-muted-foreground">Latest 5 failures across SMS and email.</p>
                  </div>
                  {tenant.recentFailures.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent failures.</p>
                  ) : (
                    <ul className="space-y-3 text-sm text-muted-foreground">
                      {tenant.recentFailures.map((failure) => (
                        <li key={failure.id} className="rounded-md border border-border bg-background p-3">
                          <p className="font-medium text-foreground">
                            {failure.channel.toUpperCase()} • {new Date(failure.createdAt).toLocaleString()}
                          </p>
                          <p>{failure.error}</p>
                          {failure.leadName && <p className="text-xs">Lead: {failure.leadName}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  )
}
