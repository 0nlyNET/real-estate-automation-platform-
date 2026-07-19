"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { PageShell } from "@/app/app/_components/PageShell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiFetch } from "@/lib/api"
import { CheckCircle2, MessageSquareText, Sparkles } from "lucide-react"

type LeadType = "buyer" | "seller" | "investor" | "renter"
type Temperature = "hot" | "warm" | "cold"
type Step = { channel: "sms" | "email"; offsetMinutes: number; template: string; identityLabel: string }
type Template = {
  name: string
  description: string
  leadType: LeadType
  temperature: Temperature
  outcome: string
  steps: Step[]
}
type SequenceSummary = { id: string; name: string }

const templates: Template[] = [
  {
    name: "Buyer consultation follow-up",
    description: "Respond immediately, offer a consultation, and check back over three days.",
    leadType: "buyer",
    temperature: "warm",
    outcome: "Book a buyer consultation",
    steps: [
      {
        channel: "sms",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 0,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, thanks for reaching out about your home search. I can help narrow down the right options. You can book a quick consultation here: {{bookingLink}} Reply STOP to opt out.",
      },
      {
        channel: "email",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 1440,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, I wanted to follow up on your home search. If you share your preferred area, price range, and timing, I can prepare a focused list of options. You can also choose a time here: {{bookingLink}} Unsubscribe: {{unsubscribeUrl}}",
      },
      {
        channel: "sms",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 4320,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, are you still looking for a home? I am happy to help whenever the timing is right. {{bookingLink}} Reply STOP to opt out.",
      },
    ],
  },
  {
    name: "Seller valuation follow-up",
    description: "Move seller leads toward a pricing conversation and listing appointment.",
    leadType: "seller",
    temperature: "warm",
    outcome: "Schedule a home-value consultation",
    steps: [
      {
        channel: "sms",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 0,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, thanks for asking about selling your property. I can prepare a local pricing review and explain the next steps. Book a time here: {{bookingLink}} Reply STOP to opt out.",
      },
      {
        channel: "email",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 1440,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, a useful home-value estimate depends on condition, upgrades, timing, and recent nearby sales. I would be glad to review those with you: {{bookingLink}} Unsubscribe: {{unsubscribeUrl}}",
      },
      {
        channel: "sms",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 4320,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, would a quick pricing and selling-plan conversation be helpful this week? {{bookingLink}} Reply STOP to opt out.",
      },
    ],
  },
  {
    name: "Renter qualification follow-up",
    description: "Collect timing and preferences before presenting available rentals.",
    leadType: "renter",
    temperature: "warm",
    outcome: "Qualify and schedule a rental consultation",
    steps: [
      {
        channel: "sms",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 0,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, thanks for reaching out about a rental. What move-in date, neighborhood, and monthly budget are you targeting? You can also book here: {{bookingLink}} Reply STOP to opt out.",
      },
      {
        channel: "email",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 1440,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, I can help focus the rental search once I know your move-in date, budget, preferred areas, and bedroom count. Choose a quick call time here: {{bookingLink}} Unsubscribe: {{unsubscribeUrl}}",
      },
      {
        channel: "sms",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 2880,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, are you still planning a move? Send your target date and budget and I can help with next steps. Reply STOP to opt out.",
      },
    ],
  },
  {
    name: "Investor deal criteria follow-up",
    description: "Capture acquisition criteria and move investor leads toward a strategy call.",
    leadType: "investor",
    temperature: "warm",
    outcome: "Document buy box and book a strategy call",
    steps: [
      {
        channel: "sms",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 0,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, thanks for reaching out about investment property. What markets, property types, price range, and return targets are in your buy box? {{bookingLink}} Reply STOP to opt out.",
      },
      {
        channel: "email",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 1440,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, send over your preferred market, asset type, budget, financing approach, and target return. I can use that to focus the search. Strategy call: {{bookingLink}} Unsubscribe: {{unsubscribeUrl}}",
      },
      {
        channel: "sms",
        identityLabel: "YOUR TEAM NAME",
        offsetMinutes: 4320,
        template:
          "YOUR TEAM NAME: Hi {{leadName}}, I am ready to help when you want to review investment criteria or available opportunities. {{bookingLink}} Reply STOP to opt out.",
      },
    ],
  },
]

export default function TemplatesPage() {
  const [sequences, setSequences] = useState<SequenceSummary[]>([])
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    apiFetch<SequenceSummary[]>("/sequences")
      .then((items) => active && setSequences(Array.isArray(items) ? items : []))
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Templates could not be loaded",
          )
      })
    return () => {
      active = false
    }
  }, [])

  const installedNames = useMemo(
    () => new Set(sequences.map((sequence) => sequence.name)),
    [sequences],
  )

  async function install(template: Template) {
    setInstalling(template.name)
    setError("")
    try {
      const sequence = await apiFetch<{ id: string }>("/sequences", {
        method: "POST",
        body: {
          name: template.name,
          description: `${template.description} Goal: ${template.outcome}.`,
          leadType: template.leadType,
          temperature: template.temperature,
          active: false,
        },
      })
      for (const step of template.steps) {
        await apiFetch(`/sequences/${sequence.id}/steps`, {
          method: "POST",
          body: step,
        })
      }
      setSequences((current) => [
        ...current,
        { id: sequence.id, name: template.name },
      ])
    } catch (installError: unknown) {
      setError(
        installError instanceof Error
          ? `${installError.message}. Any partial sequence was left inactive for safe review.`
          : "Template could not be installed",
      )
    } finally {
      setInstalling(null)
    }
  }

  return (
    <PageShell
      title="Templates"
      subtitle="Install practical real-estate follow-up sequences, then customize them."
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Template action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Alert>
        <Sparkles />
        <AlertTitle>Built for common lead journeys</AlertTitle>
        <AlertDescription>
          Templates use supported merge fields, sender identity placeholders,
          SMS opt-out language, and email unsubscribe links. Installed templates
          stay inactive until you replace “YOUR TEAM NAME,” review, and approve each step.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((template) => {
          const installed = installedNames.has(template.name)
          return (
            <Card key={template.name}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquareText className="h-5 w-5" /> {template.name}
                    </CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{template.leadType}</Badge>
                      <Badge variant="outline">{template.steps.length} steps</Badge>
                    </div>
                  </div>
                  {installed ? (
                    <Badge>
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Installed
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {template.description}
                </p>
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <span className="font-medium">Goal:</span> {template.outcome}
                </div>
                <div className="space-y-2">
                  {template.steps.map((step, index) => (
                    <div
                      key={`${step.channel}-${step.offsetMinutes}`}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>
                        {index + 1}. {step.channel.toUpperCase()}
                      </span>
                      <span className="text-muted-foreground">
                        {step.offsetMinutes === 0
                          ? "Immediately"
                          : `After ${Math.round(step.offsetMinutes / 1440)} day(s)`}
                      </span>
                    </div>
                  ))}
                </div>
                {installed ? (
                  <Button asChild variant="outline">
                    <Link href="/app/automations">Review automation</Link>
                  </Button>
                ) : (
                  <Button
                    onClick={() => install(template)}
                    disabled={Boolean(installing)}
                  >
                    {installing === template.name
                      ? "Installing..."
                      : "Install template"}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </PageShell>
  )
}
