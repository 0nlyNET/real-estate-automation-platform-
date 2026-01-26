import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CookieBanner } from "@/components/ui/cookie-banner"

const installs = [
  "Instant SMS/email follow-up",
  "Missed-call text back",
  "Booking automation",
  "Nurture sequences",
  "Reporting",
]

const timeline = [
  {
    step: "Day 0",
    title: "Intake",
    description: "We map your lead sources, routing rules, and follow-up goals.",
  },
  {
    step: "Day 1",
    title: "Connect tools",
    description: "We connect your CRM, calendars, inboxes, and lead sources.",
  },
  {
    step: "Day 2",
    title: "Go live",
    description: "We test every path and launch the automations with your team.",
  },
]

const outcomes = [
  "Faster response times across every lead source",
  "More booked appointments with less manual follow-up",
  "Clear visibility into lead performance",
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              We install your lead follow-up system so leads stop going cold.
            </h1>
            <p className="mt-6 text-pretty text-lg text-muted-foreground sm:text-xl">
              Done-for-you setup for real estate teams that want faster responses and more booked appointments.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/book">Book a call</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/apply">Apply to work with us</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">What we install</h2>
            <p className="mt-4 text-muted-foreground">A simple, proven system tailored to your team.</p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {installs.map((item) => (
              <Card key={item} className="border-border bg-card">
                <CardContent className="p-6">
                  <p className="text-sm font-medium text-foreground">{item}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Timeline</h2>
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {timeline.map((item) => (
              <Card key={item.step} className="border-border bg-background">
                <CardContent className="space-y-4 p-6">
                  <div className="text-sm font-semibold uppercase tracking-wide text-primary">{item.step}</div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Typical outcomes</h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {outcomes.map((item) => (
              <Card key={item} className="border-border bg-card">
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground">{item}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-foreground">Ready to get started?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Book a call or apply to reserve a spot for your install.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/book">Book a call</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/apply">Apply now</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
      <CookieBanner />
    </div>
  )
}
