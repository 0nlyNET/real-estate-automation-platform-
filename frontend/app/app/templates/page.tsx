"use client"

import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function TemplatesPage() {
  return (
    <PageShell title="Templates" subtitle="Reusable message templates for speed and consistency.">
      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Templates UI will be wired to the backend templates store.
        </CardContent>
      </Card>
    </PageShell>
  )
}
