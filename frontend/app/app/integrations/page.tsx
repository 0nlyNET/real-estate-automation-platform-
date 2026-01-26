"use client"

import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function IntegrationsPage() {
  return (
    <PageShell title="Integrations" subtitle="Twilio, email provider, and lead sources.">
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Wiring remains server-driven. This page will expose connection status and test tools.
        </CardContent>
      </Card>
    </PageShell>
  )
}
