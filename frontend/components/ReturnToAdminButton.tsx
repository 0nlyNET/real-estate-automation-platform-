"use client"

import { Button } from "@/components/ui/button"
import { exitImpersonation } from '@/lib/impersonation'

export function ReturnToAdminButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => exitImpersonation()}>
      Return to admin
    </Button>
  )
}
