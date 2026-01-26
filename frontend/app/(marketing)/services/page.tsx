import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

const deliverables = [
  "Lead source connections and routing",
  "Instant SMS/email follow-up",
  "Missed-call text back",
  "Booking automation",
  "Reporting dashboards",
]

const included = [
  "Audit of current lead flow",
  "Automation build + QA",
  "Team handoff and training",
  "Launch support",
]

const weNeed = [
  "Access to CRM + lead sources",
  "Calendar availability",
  "Brand voice and compliance notes",
]

export default function ServicesPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Done-for-you lead follow-up installs
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              We design, build, and launch the system so your team can focus on appointments.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="border-border bg-card">
              <CardContent className="space-y-4 p-6">
                <h2 className="text-xl font-semibold text-foreground">Deliverables</h2>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {deliverables.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card className="border-border bg-card">
              <CardContent className="space-y-4 p-6">
                <h2 className="text-xl font-semibold text-foreground">What’s included</h2>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {included.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card className="border-border bg-card">
              <CardContent className="space-y-4 p-6">
                <h2 className="text-xl font-semibold text-foreground">What we need from you</h2>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {weNeed.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-foreground">Book a call to get started</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            We will review your current follow-up and outline the exact install plan.
          </p>
          <Button size="lg" asChild className="mt-8 bg-primary text-primary-foreground hover:bg-primary/90">
            <Link href="/book">Book a call</Link>
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  )
}
