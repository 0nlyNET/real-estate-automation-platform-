"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function LockedFeature({
  title,
  requiredLabel,
  description,
}: {
  title: string
  requiredLabel: string
  description: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{title}</span>
          <span className="text-[11px] rounded bg-muted px-2 py-0.5">{requiredLabel}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex gap-2">
          <Link href="/app/billing/upgrade">
            <Button size="sm">Upgrade</Button>
          </Link>
          <Link href="/pricing">
            <Button size="sm" variant="outline">See plans</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
