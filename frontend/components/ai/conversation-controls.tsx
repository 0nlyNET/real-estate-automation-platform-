"use client"

import { useCallback, useEffect, useState } from "react"
import { Bot, Hand, Play, ShieldAlert } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

type AiDraft = {
  id: string
  body: string
  channel: "sms" | "email"
  createdAt: string
}

export type ConversationAiView = {
  leadId: string
  ownershipStatus:
    | "ai_handling"
    | "human_handling"
    | "waiting_for_human"
    | "paused"
    | "closed"
  aiTurnCount: number
  aiPausedReason?: string | null
  escalationReason?: string | null
  aiGeneratedSummary?: string | null
  informationCollected?: Record<string, unknown>
  recommendedNextAction?: string | null
  drafts: AiDraft[]
}

function ownershipLabel(status: ConversationAiView["ownershipStatus"]) {
  if (status === "ai_handling") return "AI handling"
  if (status === "human_handling") return "Human handling"
  if (status === "waiting_for_human") return "Waiting for human"
  return status.replaceAll("_", " ")
}

export function AiConversationControls({
  leadId,
  onChanged,
}: {
  leadId: string
  onChanged?: () => void | Promise<void>
}) {
  const [conversation, setConversation] =
    useState<ConversationAiView | null>(null)
  const [editedDrafts, setEditedDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<ConversationAiView>(
        `/ai/conversations/${leadId}`,
      )
      setConversation(next)
      setEditedDrafts(
        Object.fromEntries(next.drafts.map((draft) => [draft.id, draft.body])),
      )
      setError("")
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "AI conversation controls could not be loaded",
      )
    }
  }, [leadId])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function act(
    key: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    setBusy(key)
    setError("")
    try {
      await apiFetch(path, { method: "POST", body })
      await load()
      await onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed")
    } finally {
      setBusy(null)
    }
  }

  function returnToAi() {
    if (
      !window.confirm(
        "Return this conversation to the approved AI assistant? It may respond only after all consent, service, policy, and confidence checks pass.",
      )
    ) {
      return
    }
    void act(
      "return",
      `/ai/conversations/${leadId}/return-to-ai`,
      { confirmed: true },
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" /> Conversation control
          </CardTitle>
          {conversation ? (
            <Badge
              variant={
                conversation.ownershipStatus === "waiting_for_human"
                  ? "destructive"
                  : "outline"
              }
            >
              {ownershipLabel(conversation.ownershipStatus)}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        ) : null}
        {!conversation && !error ? (
          <p className="text-sm text-muted-foreground">
            Loading conversation controls…
          </p>
        ) : null}
        {conversation ? (
          <>
            {conversation.aiPausedReason || conversation.escalationReason ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="h-4 w-4" /> Human attention required
                </div>
                <p className="mt-1 text-muted-foreground">
                  {conversation.escalationReason ||
                    conversation.aiPausedReason}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {conversation.ownershipStatus === "ai_handling" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(
                      "takeover",
                      `/ai/conversations/${leadId}/take-over`,
                      {
                        reason:
                          "An authorized team member took over from the inbox.",
                      },
                    )
                  }
                >
                  <Hand /> {busy === "takeover" ? "Taking over…" : "Take Over"}
                </Button>
              ) : conversation.ownershipStatus !== "closed" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={returnToAi}
                >
                  <Play /> {busy === "return" ? "Returning…" : "Return to AI"}
                </Button>
              ) : null}
            </div>

            {conversation.aiGeneratedSummary ? (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="font-medium">AI-generated summary</div>
                <p className="mt-1 text-muted-foreground">
                  {conversation.aiGeneratedSummary}
                </p>
              </div>
            ) : null}
            {Object.keys(conversation.informationCollected || {}).length ? (
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">Information collected</div>
                <dl className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                  {Object.entries(conversation.informationCollected || {}).map(
                    ([key, value]) => (
                      <div key={key}>
                        <dt className="inline font-medium text-foreground">
                          {key.replaceAll("_", " ")}:{" "}
                        </dt>
                        <dd className="inline">
                          {value == null ? "Not known" : String(value)}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            ) : null}
            {conversation.recommendedNextAction ? (
              <p className="text-sm">
                <span className="font-medium">Recommended next action:</span>{" "}
                {conversation.recommendedNextAction}
              </p>
            ) : null}

            {conversation.drafts.map((draft) => (
              <div
                key={draft.id}
                className="space-y-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">Draft awaiting approval</div>
                  <Badge variant="secondary">{draft.channel}</Badge>
                </div>
                <Textarea
                  aria-label="AI draft"
                  rows={5}
                  value={editedDrafts[draft.id] ?? draft.body}
                  onChange={(event) =>
                    setEditedDrafts((current) => ({
                      ...current,
                      [draft.id]: event.target.value,
                    }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(
                        `approve:${draft.id}`,
                        `/ai/conversations/${leadId}/drafts/${draft.id}/approve`,
                      )
                    }
                  >
                    Approve and send
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      Boolean(busy) ||
                      !(editedDrafts[draft.id] || "").trim() ||
                      editedDrafts[draft.id] === draft.body
                    }
                    onClick={() =>
                      void act(
                        `edit:${draft.id}`,
                        `/ai/conversations/${leadId}/drafts/${draft.id}/edit-and-send`,
                        { body: editedDrafts[draft.id] },
                      )
                    }
                  >
                    Edit and send
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(
                        `reject:${draft.id}`,
                        `/ai/conversations/${leadId}/drafts/${draft.id}/reject`,
                      )
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(
                        "takeover",
                        `/ai/conversations/${leadId}/take-over`,
                        { reason: "A team member took over while reviewing a draft." },
                      )
                    }
                  >
                    Take Over
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Editing and sending switches this conversation to human
                  handling.
                </p>
              </div>
            ))}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
