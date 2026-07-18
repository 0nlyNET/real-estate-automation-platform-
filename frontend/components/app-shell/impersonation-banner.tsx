'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { ReturnToAdminButton } from '@/components/ReturnToAdminButton'
import {
  AUTH_CHANGED_EVENT,
  getImpersonatedUserRaw,
} from '@/lib/impersonation'

function subscribe(callback: () => void) {
  window.addEventListener(AUTH_CHANGED_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(AUTH_CHANGED_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export function ImpersonationBanner() {
  const raw = useSyncExternalStore(
    subscribe,
    getImpersonatedUserRaw,
    () => null,
  )
  const user = useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as { email?: string }) : null
    } catch {
      return null
    }
  }, [raw])

  if (!user) return null

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-semibold">Support view</span>
          <span className="text-muted-foreground">
            {' '}for {user.email || 'this client'}. Actions are audited and this session expires after 15 minutes.
          </span>
        </div>
        <ReturnToAdminButton />
      </div>
    </div>
  )
}
