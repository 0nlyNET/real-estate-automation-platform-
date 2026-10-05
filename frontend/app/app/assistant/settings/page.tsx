"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { AiAssistantSettings } from "@/components/settings/ai-assistant-settings"
import { fetchMe } from "@/lib/me"

export default function AssistantSettingsPage() {
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetchMe()
      .then((me) => {
        if (!active) return
        setCanManage(me?.role === "owner" || me?.role === "admin")
      })
      .catch(() => {
        if (active) setCanManage(false)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  return (
    <PageShell
      title="Assistant settings"
      subtitle="Configure the AI identity, response behavior, and approved business knowledge. Changes require approval before the assistant can use them."
    >
      <Link
        href="/app/assistant"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to AI assistant
      </Link>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading permissions…</p>
      ) : (
        <AiAssistantSettings canManage={canManage} />
      )}
      {!loading && !canManage ? (
        <p className="text-sm text-muted-foreground">
          Only a workspace owner or admin can change assistant settings.
        </p>
      ) : null}
    </PageShell>
  )
}
