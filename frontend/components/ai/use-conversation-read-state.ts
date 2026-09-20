"use client"

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { apiFetch } from "@/lib/api"

export type ConversationReadState = {
  leadId: string
  lastReadMessageId: string | null
  unreadCount: number
  isUnread: boolean
  markedUnread: boolean
  unreadVersion: number
}

export function useConversationReadState({ leadId, messages, readState, viewport, onUpdated }: {
  leadId: string | null
  messages: { id: string; direction: "inbound" | "outbound" }[]
  readState: ConversationReadState | null
  viewport: RefObject<HTMLDivElement | null>
  onUpdated: (state: ConversationReadState) => void
}) {
  const [readError, setReadError] = useState("")
  const [readBusy, setReadBusy] = useState(false)
  const versions = useRef(new Map<string, number>())
  const acknowledged = useRef(new Set<string>())
  const suppressed = useRef<string | null>(null)
  const active = useRef(leadId)
  const queue = useRef(Promise.resolve())
  const visibleMessage = useRef<string | null>(null)

  useEffect(() => {
    active.current = leadId
    if (leadId) versions.current.delete(leadId)
    suppressed.current = null
    visibleMessage.current = null
    return () => { active.current = null }
  }, [leadId])

  useEffect(() => {
    if (!readState) return
    const previous = versions.current.get(readState.leadId)
    if (previous !== undefined && readState.markedUnread && readState.unreadVersion > previous &&
        active.current === readState.leadId) suppressed.current = readState.leadId
    versions.current.set(readState.leadId, Math.max(previous || 0, readState.unreadVersion))
  }, [readState])

  const acknowledge = useCallback((messageId: string) => {
    if (!leadId || readState?.leadId !== leadId || suppressed.current === leadId ||
        document.visibilityState !== "visible") return
    const unreadVersion = versions.current.get(leadId) ?? readState.unreadVersion
    const key = `${leadId}:${unreadVersion}:${messageId}`
    if (acknowledged.current.has(key)) return
    acknowledged.current.add(key)
    // Serialize writes within this tab; the backend also protects concurrent tabs.
    queue.current = queue.current.then(async () => {
      if (active.current !== leadId || suppressed.current === leadId || document.visibilityState !== "visible") {
        acknowledged.current.delete(key)
        return
      }
      try {
        const state = await apiFetch<ConversationReadState>(`/messaging/threads/${leadId}/read`, {
          method: "POST", body: { messageId, unreadVersion },
        })
        // Another tab may have marked unread while this request was in flight.
        // Do not automatically retry the same old view with its newer version.
        if (state.markedUnread && state.unreadVersion > unreadVersion) suppressed.current = leadId
        versions.current.set(leadId, Math.max(versions.current.get(leadId) || 0, state.unreadVersion))
        onUpdated(state)
        setReadError("")
      } catch (cause) {
        acknowledged.current.delete(key)
        setReadError(cause instanceof Error ? cause.message : "Read status could not be saved. Reopen the conversation to retry.")
      }
    })
  }, [leadId, onUpdated, readState])

  useEffect(() => {
    const root = viewport.current
    if (!root || !leadId || !messages.length) return
    const visible = new Set<string>()
    let readTimer: ReturnType<typeof setTimeout> | undefined
    const markVisible = () => {
      clearTimeout(readTimer)
      const visibleMessages = [...messages].reverse().filter((message) => {
        if (!visible.has(message.id)) return false
        const bounds = root.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`)?.getBoundingClientRect()
        // An explicit observer root may itself be outside the browser viewport.
        return bounds && bounds.bottom > 0 && bounds.top < window.innerHeight &&
          bounds.right > 0 && bounds.left < window.innerWidth
      })
      // Sending a reply does not prove that earlier inbound messages were seen.
      // Outbound-only views may clear a manual marker, but the server never
      // advances the inbound read boundary through an outbound message.
      const latest = visibleMessages.find((message) => message.direction === "inbound") || visibleMessages[0]
      visibleMessage.current = latest?.id || null
      // Coalesce scrolling into one acknowledgement of the settled viewport.
      if (latest) readTimer = setTimeout(() => acknowledge(latest.id), 200)
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.messageId!
        if (entry.isIntersecting) visible.add(id)
        else visible.delete(id)
      }
      markVisible()
    }, { root, threshold: 0.01 })
    root.querySelectorAll("[data-message-id]").forEach((node) => observer.observe(node))
    document.addEventListener("visibilitychange", markVisible)
    window.addEventListener("scroll", markVisible, { passive: true })
    return () => {
      clearTimeout(readTimer)
      observer.disconnect()
      document.removeEventListener("visibilitychange", markVisible)
      window.removeEventListener("scroll", markVisible)
    }
  }, [acknowledge, leadId, messages, viewport])

  async function markUnread() {
    if (!leadId) return
    suppressed.current = leadId
    setReadBusy(true)
    try {
      await queue.current
      const state = await apiFetch<ConversationReadState>(`/messaging/threads/${leadId}/unread`, { method: "POST" })
      versions.current.set(leadId, state.unreadVersion)
      onUpdated(state)
      setReadError("")
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : "Unread status could not be saved.")
    } finally { setReadBusy(false) }
  }

  function markVisibleRead() {
    suppressed.current = null
    if (visibleMessage.current) acknowledge(visibleMessage.current)
  }

  return { markUnread, markVisibleRead, readBusy, readError }
}
