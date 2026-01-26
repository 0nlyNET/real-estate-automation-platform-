"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/app-shell/app-shell"
import { apiFetch, ApiError } from "@/lib/api"

type MeResponse = {
  userId: string
  tenantId: string
  email: string
  role: string
}

export default function AgencyHomePage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiFetch<MeResponse>("/me", { auth: true })
        setMe(data)
      } catch (err) {
        const apiError = err as ApiError
        if (apiError?.status === 401) {
          setError("You are not logged in. Go to /login.")
        } else if (apiError?.status === 403) {
          setError("This account is not an agency admin.")
        } else if (apiError?.status === 0) {
          setError("Network/CORS issue. Check NEXT_PUBLIC_API_URL and FRONTEND_URL.")
        } else if (apiError?.status) {
          setError(`${apiError.status}: ${apiError.message}`)
        } else {
          setError("Unable to load profile.")
        }
      }
    }

    load()
  }, [])

  const isAgencyAdmin = me?.role === "AGENCY_ADMIN"

  return (
    <AppShell>
      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            <h1 className="text-3xl font-bold text-foreground">Agency Dashboard</h1>
            <p className="text-muted-foreground">
              Internal operations hub for managing tenants, installs, and system health.
            </p>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {!me && !error && <p className="text-sm text-muted-foreground">Loading profile…</p>}

            {me && !isAgencyAdmin && (
              <Card className="border-border bg-card">
                <CardContent className="space-y-3 p-6">
                  <p className="text-sm text-muted-foreground">
                    You do not have agency admin access for this workspace.
                  </p>
                  <Button asChild variant="outline">
                    <Link href="/app/dashboard">Back to app</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {me && isAgencyAdmin && (
              <Card className="border-border bg-card">
                <CardContent className="space-y-4 p-6">
                  <p className="text-sm text-muted-foreground">Signed in as {me.email}</p>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild>
                      <Link href="/agency/tenants">View tenants</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/app/dashboard">Back to app</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  )
}
