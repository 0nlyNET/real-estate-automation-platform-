import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { ArrowRight, Target, Heart, Zap } from "lucide-react"

const values = [
  {
    icon: Zap,
    title: "Speed matters",
    description: "In real estate, the first to respond wins. We build everything with speed in mind.",
  },
  {
    icon: Target,
    title: "Customer obsessed",
    description: "We exist to help agents succeed. Every feature starts with customer feedback.",
  },
  {
    icon: Heart,
    title: "Transparency first",
    description: "No hidden fees, no gotchas. We believe in honest pricing and open communication.",
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      {/* Hero */}
      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              About <span className="text-primary">RealtyTechAI</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              We build practical lead-response and follow-up tools for real estate professionals.
            </p>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-3xl font-bold text-foreground">Our story</h2>
            <div className="mt-6 space-y-4 text-muted-foreground">
              <p>
                RealtyTechAI is built around a simple problem: new inquiries arrive while agents are showing homes,
                meeting clients, and running their business.
              </p>
              <p>
                The platform brings lead intake, assignment, messaging, follow-up sequences, and response reporting
                into one tenant-isolated workspace.
              </p>
              <p>
                It is designed to help teams respond consistently while keeping people in control of conversations,
                routing rules, compliance settings, and billing.
              </p>
              <p>
                RealtyTechAI is under active development. Capabilities described on this site reflect the current
                product; results depend on each team's process, providers, and lead volume.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="border-t border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-foreground">Our values</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {values.map((value, index) => (
              <Card key={index} className="border-border bg-card">
                <CardContent className="p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <value.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">{value.title}</h3>
                  <p className="mt-2 text-muted-foreground">{value.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Product approach */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-foreground">How we build</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            We favor clear workflows, tenant-safe data access, honest product claims, and automation that agents can
            inspect and control.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-foreground">See whether RealtyTechAI fits your workflow</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Create an account or contact us to discuss your lead sources, team structure, and messaging providers.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/signup">
                Start free trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/contact">Contact us</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
