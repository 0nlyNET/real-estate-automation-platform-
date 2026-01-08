import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { User, Users, Building2, ArrowRight, CheckCircle2 } from "lucide-react"

const useCases = [
  {
    icon: User,
    title: "Solo Agents",
    subtitle: "Work smarter, not harder",
    description:
      "As a solo agent, you're juggling everything. RealtyTechAI becomes your virtual assistant, handling lead follow-ups while you focus on showings and closings.",
    benefits: [
      "Respond to leads instantly, even when you're with clients",
      "Automated drip campaigns keep leads warm",
      "Never forget a follow-up with smart reminders",
      "Track all your conversations in one place",
    ],
    stats: [
      { value: "5x", label: "Faster response time" },
      { value: "40%", label: "More appointments booked" },
      { value: "12hrs", label: "Saved per week" },
    ],
    testimonial: {
      quote: "I used to lose leads because I couldn't respond fast enough. Now I never miss an opportunity.",
      author: "Mike Torres",
      role: "Solo Agent, Austin TX",
    },
  },
  {
    icon: Users,
    title: "Teams",
    subtitle: "Scale your operations",
    description:
      "Managing a team means ensuring consistent follow-up across all agents. RealtyTechAI provides the visibility and automation you need to scale.",
    benefits: [
      "Round-robin lead distribution",
      "Team performance dashboards",
      "Shared template libraries",
      "Manager override and reassignment",
    ],
    stats: [
      { value: "2x", label: "Team productivity" },
      { value: "60%", label: "Faster lead assignment" },
      { value: "35%", label: "Higher conversion" },
    ],
    testimonial: {
      quote:
        "Our 8-person team runs like a well-oiled machine now. Everyone knows their leads and nothing falls through the cracks.",
      author: "Jessica Adams",
      role: "Team Lead, Keller Williams",
    },
  },
  {
    icon: Building2,
    title: "Brokerages",
    subtitle: "Enterprise-grade control",
    description:
      "Run your brokerage with confidence. RealtyTechAI gives you the tools to manage multiple teams, ensure compliance, and drive performance.",
    benefits: [
      "Multi-team management",
      "Custom branding and white-labeling",
      "Compliance and audit trails",
      "API access and custom integrations",
    ],
    stats: [
      { value: "100+", label: "Agents supported" },
      { value: "99.9%", label: "Uptime SLA" },
      { value: "24/7", label: "Priority support" },
    ],
    testimonial: {
      quote:
        "We migrated 50 agents to RealtyTechAI in a week. The onboarding was seamless and our numbers improved immediately.",
      author: "Robert Chen",
      role: "Broker/Owner, Sunrise Realty",
    },
  },
]

export default function UseCasesPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      {/* Hero */}
      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Built for every <span className="text-primary">real estate professional</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Whether you're a solo agent, team lead, or brokerage owner, RealtyTechAI scales with you.
            </p>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="space-y-24">
            {useCases.map((useCase, index) => (
              <div key={index} className="space-y-8">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <useCase.icon className="h-7 w-7" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold text-foreground">{useCase.title}</h2>
                    <p className="text-lg text-muted-foreground">{useCase.subtitle}</p>
                  </div>
                </div>

                <div className="grid gap-8 lg:grid-cols-2">
                  <div className="space-y-6">
                    <p className="text-muted-foreground">{useCase.description}</p>
                    <ul className="space-y-3">
                      {useCase.benefits.map((benefit, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                          <span className="text-muted-foreground">{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                      {useCase.stats.map((stat, i) => (
                        <Card key={i} className="border-border bg-card">
                          <CardContent className="p-4 text-center">
                            <p className="text-2xl font-bold text-primary">{stat.value}</p>
                            <p className="text-xs text-muted-foreground">{stat.label}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <Card className="border-primary/20 bg-card">
                      <CardContent className="p-6">
                        <p className="text-sm italic text-muted-foreground">"{useCase.testimonial.quote}"</p>
                        <div className="mt-4">
                          <p className="text-sm font-medium text-foreground">{useCase.testimonial.author}</p>
                          <p className="text-xs text-muted-foreground">{useCase.testimonial.role}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-foreground">Find out what RealtyTechAI can do for you</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Start your 14-day free trial. No credit card required.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/signup">
                Start free trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/pricing">View pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
