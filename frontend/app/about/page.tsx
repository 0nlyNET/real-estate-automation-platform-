import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { ArrowRight, Heart, Linkedin, Mail, Target, Zap } from "lucide-react"

const values = [
  {
    icon: Zap,
    title: "Speed matters",
    description: "We design for prompt, observable outreach without claiming an outcome or bypassing consent controls.",
  },
  {
    icon: Target,
    title: "Human supervised",
    description: "Onboarding, template approval, provider tests, and launch decisions keep people in control.",
  },
  {
    icon: Heart,
    title: "Transparency first",
    description: "We document scope, provider dependencies, pricing, limitations, and launch evidence before activation.",
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

      {/* Founder */}
      <section className="border-y border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Card className="mx-auto max-w-4xl overflow-hidden border-border bg-card shadow-sm">
            <CardContent className="grid gap-8 p-8 md:grid-cols-[1fr_auto] md:items-center md:p-10">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
                  Founder & authorized representative
                </p>
                <h2 className="mt-3 text-3xl font-bold text-foreground">Jayden King</h2>
                <div className="mt-5 space-y-4 text-muted-foreground">
                  <p>
                    Jayden King is the founder and authorized representative of RealtyTechAI, the business that
                    operates the RealtyTechAI platform and managed lead-response service.
                  </p>
                  <p>
                    RealtyTechAI is the current business name, formerly ONLY MOTION. This public record connects the
                    current company name, the former name, and its authorized representative.
                  </p>
                </div>
                <a
                  href="mailto:jayden@realtytechai.app"
                  className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
                >
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  jayden@realtytechai.app
                </a>
              </div>

              <Button asChild variant="outline" size="lg" className="w-full md:w-auto">
                <a
                  href="https://www.linkedin.com/in/jayden-king-9a3070368/"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View Jayden King on LinkedIn"
                >
                  <Linkedin className="mr-2 h-5 w-5" aria-hidden="true" />
                  View LinkedIn
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Values */}
      <section className="py-24">
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
      <section className="border-t border-border py-24">
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
            Apply to discuss your lead sources, team structure, messaging providers, and supervised pilot scope.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/apply">
                Apply for pilot
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/apply">Contact us</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
