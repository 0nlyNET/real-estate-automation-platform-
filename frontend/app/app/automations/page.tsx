"use client"

import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function AutomationsPage() {
  return (
    <PageShell title="Automations" subtitle="Sequences, delays, channels, and pause/resume.">
      <Card>
        <CardHeader>
          <CardTitle>Automations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Automation editor UI comes next. Backend sequences already exist.
        </CardContent>
      </Card>
    </PageShell>
  )
}
