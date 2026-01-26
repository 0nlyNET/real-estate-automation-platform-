"use client"

import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SettingsPage() {
  return (
    <PageShell title="Settings" subtitle="Workspace preferences.">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Settings UI will be expanded after routing and compliance are enforced end-to-end.
        </CardContent>
      </Card>
    </PageShell>
  )
}
