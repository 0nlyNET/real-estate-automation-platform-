"use client"

import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardKpis } from "@/components/dashboard/kpis"
import { DashboardSetupSection } from "@/components/dashboard/setup-section"

export default function DashboardPage() {
  return (
    <PageShell title="Home" subtitle="See what is happening now and what needs your attention next.">
      <DashboardKpis />
      <DashboardSetupSection />
      <Card>
        <CardHeader>
          <CardTitle>Next actions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Finish your setup, connect the accounts you want RealtyTechAI to use, and confirm who should receive each lead. Your setup team handles testing and activation.
        </CardContent>
      </Card>
    </PageShell>
  )
}
