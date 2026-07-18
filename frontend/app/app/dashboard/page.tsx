"use client"

import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardKpis } from "@/components/dashboard/kpis"
import { DashboardSetupSection } from "@/components/dashboard/setup-section"

export default function DashboardPage() {
  return (
    <PageShell title="Dashboard" subtitle="Speed to lead, activity, and performance at a glance.">
      <DashboardKpis />
      <DashboardSetupSection />
      <Card>
        <CardHeader>
          <CardTitle>Next actions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Connect integrations, set routing rules, and start a follow up sequence.
        </CardContent>
      </Card>
    </PageShell>
  )
}
