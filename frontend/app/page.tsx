import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CookieBanner } from "@/components/ui/cookie-banner"
import { Zap, MessageSquare, Calendar, BarChart3, ArrowRight, CheckCircle2, Shield, Clock, Users } from "lucide-react"

const features = [
  {
    icon: Zap,
    title: "Speed-to-Lead",
    description: "Respond to new leads within seconds, not hours. Increase your conversion rate by 391%.",
  },
  {
    icon: MessageSquare,
    title: "Unified Inbox",
    description: "All your conversations in one place. Email, SMS, and more - never miss a lead again.",
  },
  {
    icon: Calendar,
    title: "Automated Bookings",
    description: "Let leads book appointments directly. Sync with your calendar automatically.",
  },
  {
    icon: BarChart3,
    title: "Smart Reporting",
    description: "Track response times, conversion rates, and team performance in real-time.",
  },
]

const integrations = ["Facebook Lead Ads", "Zapier", "Google Calendar", "Webhooks", "Gmail", "Outlook"]

const testimonials = [
  {
    quote: "RealtyTechAI cut our response time from 2 hours to 30 seconds. Our conversion rate doubled.",
    author: "Sarah Chen",
    role: "Team Lead, Metro Realty",
  },
  {
    quote: "The automation sequences are a game-changer. I close more deals with less manual follow-up.",
    author: "Marcus Johnson",
    role: "Solo Agent, JM Properties",
  },
  {
    quote: "Finally, a platform built for real estate teams. Our 15-agent team runs on RealtyTechAI.",
    author: "David Park",
    role: "Broker, Sunrise Brokerage",
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Respond to leads in seconds, <span className="text-primary">close more deals</span>
            </h1>
            <p className="mt-6 text-pretty text-lg text-muted-foreground sm:text-xl">
              RealtyTechAI is the speed-to-lead automation platform that helps real estate agents capture, nurture, and
              convert leads on autopilot.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/signup">
                  Start free trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/contact">Book a demo</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">No credit card required</p>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="border-b border-border bg-card/50 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="mb-8 text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Trusted by top-performing agents and teams
          </p>
          <div className="grid grid-cols-2 gap-8 md:grid-cols-3">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="border-border bg-card transition-all duration-200 hover:border-primary/50">
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground">"{testimonial.quote}"</p>
                  <div className="mt-4">
                    <p className="text-sm font-medium text-foreground">{testimonial.author}</p>
                    <p className="text-xs text-muted-foreground">{testimonial.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">How it works</h2>
            <p className="mt-4 text-muted-foreground">
              Get set up in minutes, not days. Three simple steps to lead automation success.
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "Connect your lead sources",
                description: "Integrate Facebook Lead Ads, Zapier, or custom webhooks to capture leads automatically.",
              },
              {
                step: "2",
                title: "Set up automations",
                description: "Create follow-up sequences that respond instantly and nurture leads until they're ready.",
              },
              {
                step: "3",
                title: "Close more deals",
                description:
                  "Focus on qualified leads while RealtyTechAI handles the rest. Watch your conversion rate soar.",
              },
            ].map((item, index) => (
              <div key={index} className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                  {item.step}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Everything you need to convert leads faster
            </h2>
            <p className="mt-4 text-muted-foreground">
              Built specifically for real estate professionals who want to close more deals.
            </p>
          </div>
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="group border-border bg-card transition-all duration-200 hover:border-primary/50 hover:shadow-lg"
              >
                <CardContent className="p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">{feature.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Connects with your favorite tools
            </h2>
            <p className="mt-4 text-muted-foreground">Seamless integrations with the platforms you already use.</p>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            {integrations.map((integration, index) => (
              <div
                key={index}
                className="rounded-full border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-all duration-200 hover:border-primary/50 hover:bg-primary/5"
              >
                {integration}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="border-b border-border bg-card/50 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
            <div className="flex items-center gap-4">
              <Shield className="h-10 w-10 text-primary" />
              <div>
                <h3 className="text-lg font-semibold text-foreground">Enterprise-grade security</h3>
                <p className="text-sm text-muted-foreground">
                  SOC 2 compliant, encrypted data, and secure infrastructure.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              {["256-bit encryption", "99.9% uptime", "GDPR compliant"].map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="text-sm text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
            <CardContent className="p-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Ready to close more deals?
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
                Join thousands of real estate professionals who use RealtyTechAI to respond faster, automate follow-ups,
                and convert more leads.
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
              <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">14-day free trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Cancel anytime</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Footer />
      <CookieBanner />
    </div>
  )
}
