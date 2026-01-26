"use client"

import Link from "next/link"
import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function BillingPage() {
  return (
    <PageShell title="Billing" subtitle="Manage your subscription and plan.">
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <Link href="/app/billing/upgrade">
            <Button>Upgrade</Button>
          </Link>
          <Link href="/pricing">
            <Button variant="outline">Pricing</Button>
          </Link>
        </CardContent>
      </Card>
    </PageShell>
  )
}
