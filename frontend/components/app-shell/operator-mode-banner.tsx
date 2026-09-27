'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { fetchMe, type Me } from '@/lib/me'
import { exitOperatorMode, OPERATOR_MODE_CHANGED_EVENT } from '@/lib/operator-mode'

/**
 * Persistent, unmissable banner shown on every /app/* page while a platform
 * operator is assisting a client in explicit operator mode. The tenant name is
 * always visible so the operator knows exactly which workspace they are acting in.
 */
export function OperatorModeBanner() {
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    void fetchMe().then(setMe)
    const refresh = () => void fetchMe().then(setMe)
    window.addEventListener(OPERATOR_MODE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(OPERATOR_MODE_CHANGED_EVENT, refresh)
  }, [])

  if (!me?.operatorMode?.tenantId) return null

  return (
    <div
      className="border-b-2 border-sky-600 bg-sky-600 px-4 py-2.5 text-white"
      role="banner"
      aria-label="Operator mode active"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium">
          Operator mode — {me.operatorMode.tenantName}
          <span className="ml-2 font-normal text-sky-100">
            You are assisting this client as {me.operatorMode.startedByEmail}. All actions are audited.
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="bg-white text-sky-700 hover:bg-sky-50"
          onClick={() => void exitOperatorMode()}
        >
          Exit Operator Mode
        </Button>
      </div>
    </div>
  )
}
