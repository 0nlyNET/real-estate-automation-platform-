'use client'

import { useEffect, useState } from 'react'
import { ReturnToAdminButton } from '@/components/ReturnToAdminButton'
import { fetchMe, type Me } from '@/lib/me'

export function ImpersonationBanner() {
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    void fetchMe().then(setMe)
  }, [])

  if (!me?.impersonated) return null

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-semibold">Support view</span>
          <span className="text-muted-foreground">
            {' '}for {me.email}. Actions are audited. Stop support view as soon as the task is complete.
          </span>
        </div>
        <ReturnToAdminButton />
      </div>
    </div>
  )
}
