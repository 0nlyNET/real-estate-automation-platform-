"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Activity, ArrowRight } from "lucide-react"

export function DashboardRecentActivity() {
  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Recent activity
        </CardTitle>
        <Button asChild variant="outline" size="sm" className="h-8">
          <Link href="/app/reports">
            View reporting <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent>
        <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-6">
          <div className="text-sm font-medium">No activity yet</div>
          <div className="mt-1 text-sm text-muted-foreground">
            When leads arrive and messages send, you will see a timeline of events here: lead captured, sequence enrolled,
            message sent, reply received.
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm" className="h-8">
              <Link href="/app/integrations">Connect integrations</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8">
              <Link href="/app/automations">Create automation</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
