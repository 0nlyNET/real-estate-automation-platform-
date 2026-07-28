import Link from "next/link"
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Inbox,
  MessageSquareText,
  Settings2,
} from "lucide-react"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const included = [
  "Lead-source connection and intake routing",
  "Approved SMS and email follow-up workflows",
  "Reply, consent, quiet-hour, and opt-out controls",
  "Booking-link delivery and appointment follow-up",
  "Simple lead status and conversation visibility",
  "Managed setup, testing, monitoring, and support",
]

const workflow = [
  {
    icon: Inbox,
    title: "A lead enters",
    text: "RealtyTechAI captures the inquiry from an approved connected source and routes it to the correct workspace.",
  },
  {
    icon: MessageSquareText,
    title: "Follow-up starts",
    text: "The lead receives approved outreach while replies, consent status, and human-attention needs remain visible.",
  },
  {
    icon: CalendarCheck2,
    title: "The opportunity moves forward",
    text: "Qualified prospects receive the verified booking link, while the agent or team handles conversations that need a person.",
  },
]

export default function UseCasesPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <main>
        <section className="border-b py-20">
          <div className="mx-auto max-w-4xl px-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
              One offer
            </p>
            <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
              One managed lead-response system
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-lg text-muted-foreground">
              RealtyTechAI installs and manages one done-for-you system for real estate professionals. We connect your lead sources, configure approved follow-up, help move qualified opportunities toward a booking, and keep the conversations that need a person visible.
            </p>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-muted/30 p-8 sm:p-10">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <Settings2 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="mt-5 text-2xl sm:text-3xl">
                  The RealtyTechAI Managed Lead System
                </CardTitle>
                <p className="max-w-3xl text-muted-foreground">
                  One core offer, customized to your business structure, lead sources, assignment rules, branding, and booking process. This is a managed service—not separate software tiers or per-seat plans.
                </p>
              </CardHeader>

              <CardContent className="grid gap-10 p-8 sm:p-10 lg:grid-cols-2">
                <div>
                  <h2 className="text-xl font-semibold">What we install and manage</h2>
                  <ul className="mt-6 space-y-4">
                    {included.map((item) => (
                      <li className="flex items-start gap-3 text-sm" key={item}>
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h2 className="text-xl font-semibold">What happens after a lead comes in</h2>
                  <div className="mt-6 space-y-5">
                    {workflow.map(({ icon: Icon, title, text }, index) => (
                      <div className="flex gap-4" key={title}>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Step {index + 1}
                          </div>
                          <h3 className="mt-1 font-semibold">{title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="mx-auto mt-10 max-w-3xl rounded-xl border bg-muted/20 p-6 text-center">
              <h2 className="text-lg font-semibold">The offer stays the same. The setup is customized.</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                A solo agent, team, or brokerage may have different routing and access needs, but they receive the same managed RealtyTechAI service rather than choosing between separate packages.
              </p>
            </div>

            <div className="mt-10 text-center">
              <Button asChild size="lg">
                <Link href="/apply">
                  Apply for the managed system
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                We review fit, lead sources, and implementation requirements before onboarding.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
