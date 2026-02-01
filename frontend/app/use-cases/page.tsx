import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CookieBanner } from "@/components/ui/cookie-banner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight, Building2, Users, User, CheckCircle2 } from "lucide-react"

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-6 text-center">
        <div className="text-2xl font-semibold text-primary">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function Section({
  icon,
  title,
  subtitle,
  body,
  bullets,
  stats,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  body: string
  bullets: string[]
  stats: { value: string; label: string }[]
}) {
  return (
    <section className="py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {icon}
              </div>
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-foreground">{title}</h2>
                <p className="mt-1 text-muted-foreground">{subtitle}</p>
              </div>
            </div>

            <p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p>

            <ul className="mt-6 space-y-3">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
                  <span className="text-sm text-muted-foreground">{b}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8">
              <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/apply">
                  Apply Now <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="grid gap-6 sm:grid-cols-3">
              {stats.map((s) => (
                <StatCard key={s.label} value={s.value} label={s.label} />
              ))}
            </div>

            {/* Testimonials removed intentionally */}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function ResultsPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Results</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            What the system improves when you respond instantly and follow up consistently.
          </p>
        </div>
      </div>

      <div className="divide-y divide-border">
        <Section
          icon={<User className="h-6 w-6" />}
          title="Solo Agents"
          subtitle="Work smarter, not harder"
          body="As a solo agent, you're juggling everything. RealtyTechAI handles speed-to-lead and follow-up so you can focus on showings and closings."
          bullets={[
            "Respond to leads instantly, even when you're with clients",
            "Automated follow-up keeps leads warm",
            "Never forget a follow-up with smart reminders",
            "Track conversations in one place",
          ]}
          stats={[
            { value: "5x", label: "Faster response time" },
            { value: "40%", label: "More appointments booked" },
            { value: "12hrs", label: "Saved per week" },
          ]}
        />

        <Section
          icon={<Users className="h-6 w-6" />}
          title="Teams"
          subtitle="Scale your operations"
          body="Teams need consistency. We keep response and follow-up consistent across agents, and make assignment and handoff clean."
          bullets={[
            "Round-robin lead distribution",
            "Team performance visibility",
            "Shared templates for messaging and follow-up",
            "Manager override and reassignment",
          ]}
          stats={[
            { value: "2x", label: "Team productivity" },
            { value: "60%", label: "Faster lead assignment" },
            { value: "35%", label: "Higher conversion" },
          ]}
        />

        <Section
          icon={<Building2 className="h-6 w-6" />}
          title="Brokerages"
          subtitle="Enterprise-grade control"
          body="Brokerages need compliance, visibility, and consistency across multiple teams. RealtyTechAI supports multi-team operations with centralized control."
          bullets={[
            "Multi-team management",
            "Custom branding and white-labeling",
            "Compliance and audit trails",
            "API access and custom integrations",
          ]}
          stats={[
            { value: "100+", label: "Agents supported" },
            { value: "99.9%", label: "Uptime SLA" },
            { value: "24/7", label: "Priority support" },
          ]}
        />
      </div>

      <section className="border-t border-border py-16">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Find out what RealtyTechAI can do for you</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            If you are a fit, we map your lead source, install the system, and launch.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/apply">
                Apply Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/contact">Contact</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
      <CookieBanner />
    </div>
  )
}
