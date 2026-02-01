import type React from "react"
import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CookieBanner } from "@/components/ui/cookie-banner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowRight, CheckCircle2, Clock, Zap, Users, User, Building2, Shield } from "lucide-react"

function BadgeRow({ items }: { items: string[] }) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
      {items.map((t) => (
        <div key={t} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
          <span>{t}</span>
        </div>
      ))}
    </div>
  )
}

function SectionHeading({
  kicker,
  title,
  desc,
}: {
  kicker?: string
  title: string
  desc?: string
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {kicker ? (
        <div className="text-xs font-semibold tracking-wide text-primary">{kicker}</div>
      ) : null}
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {desc ? <p className="mt-3 text-sm text-muted-foreground">{desc}</p> : null}
    </div>
  )
}

function Step({
  num,
  title,
  desc,
}: {
  num: string
  title: string
  desc: string
}) {
  return (
    <Card className="border-white/10 bg-card/40">
      <CardContent className="p-7">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <span className="text-sm font-semibold">{num}</span>
          </div>
          <div>
            <div className="text-base font-semibold text-foreground">{title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{desc}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PersonaCard({
  icon,
  title,
  subtitle,
  bullets,
  href,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  bullets: string[]
  href: string
}) {
  return (
    <Card className="border-white/10 bg-card/40">
      <CardContent className="p-7">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            {icon}
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">{title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
          </div>
        </div>

        <ul className="mt-5 space-y-3">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">{b}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <Button asChild variant="outline">
            <Link href={href}>
              View results <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <Card className="border-white/10 bg-card/40">
      <CardContent className="p-6 text-center">
        <div className="text-2xl font-semibold text-primary">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-white/5">
        {/* stronger top glow + subtle vignette like the deployed look */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(1100px_circle_at_50%_20%,rgba(56,189,248,0.20),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_80%_0%,rgba(59,130,246,0.18),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(1200px_circle_at_20%_0%,rgba(14,165,233,0.16),transparent_60%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(1200px_circle_at_50%_50%,rgba(0,0,0,0.0),rgba(0,0,0,0.55))]" />
        </div>

        <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-7xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            Stop losing real estate
            <br />
            leads <span className="text-primary">after hours</span>
          </h1>

          <p className="mt-5 max-w-2xl text-sm text-muted-foreground sm:text-base">
            We install an AI response and follow-up system that answers new leads in under 60 seconds and keeps working
            until they book or go cold.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/apply">
                Apply Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>

          <BadgeRow
            items={[
              "Works with your current lead source",
              "Launch in days, not months",
              "You own your data and workflows",
            ]}
          />
        </div>
      </section>

      {/* BUILT FOR */}
      <section className="relative py-16">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-x-0 top-0 h-px bg-white/5" />
          <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,rgba(56,189,248,0.06),transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-transparent" />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            kicker="BUILT FOR AGENTS, TEAMS, AND BROKERAGES"
            title="Pick your setup. We install it for you."
            desc="Agency-first. No self-signup. We approve, configure, and launch based on your workflow."
          />

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            <PersonaCard
              icon={<User className="h-6 w-6" />}
              title="Solo Agents"
              subtitle="Speed-to-lead without losing your day"
              bullets={[
                "Instant replies when you are busy",
                "Automated follow-up that does not forget",
                "One place to track conversations",
              ]}
              href="/use-cases"
            />
            <PersonaCard
              icon={<Users className="h-6 w-6" />}
              title="Teams"
              subtitle="Consistent response and handoff"
              bullets={[
                "Round-robin lead distribution",
                "Shared templates and sequences",
                "Visibility into performance",
              ]}
              href="/use-cases"
            />
            <PersonaCard
              icon={<Building2 className="h-6 w-6" />}
              title="Brokerages"
              subtitle="Control, consistency, and compliance"
              bullets={[
                "Multi-team management",
                "Audit trails and oversight",
                "Custom workflows and integrations",
              ]}
              href="/use-cases"
            />
          </div>

          <div className="mt-10 flex items-center justify-center gap-3">
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/apply">
                Book setup <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/features">View services</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="relative py-16">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-x-0 top-0 h-px bg-white/5" />
          <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,rgba(59,130,246,0.06),transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-transparent" />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            kicker="HOW IT WORKS"
            title="Fast install. Clear outcomes."
            desc="We map your lead source, configure messaging, and launch with your rules."
          />

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            <Step num="1" title="Apply" desc="Tell us your lead source, your market, and what you want to improve." />
            <Step
              num="2"
              title="Install"
              desc="We connect the system to your workflow, set up templates, routing, and follow-up."
            />
            <Step
              num="3"
              title="Launch"
              desc="You go live. Leads get answered fast. Follow-up keeps running until they book or go cold."
            />
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            <Card className="border-white/10 bg-card/40">
              <CardContent className="p-7">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">Instant response</div>
                    <div className="mt-1 text-sm text-muted-foreground">Reply in seconds, not hours.</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-card/40">
              <CardContent className="p-7">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">Follow-up sequences</div>
                    <div className="mt-1 text-sm text-muted-foreground">Keeps working until they book.</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-card/40">
              <CardContent className="p-7">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">Your rules</div>
                    <div className="mt-1 text-sm text-muted-foreground">Your messaging, routing, and workflow.</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-10 flex items-center justify-center gap-3">
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/apply">
                Apply Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/use-cases">See results</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* RESULTS PREVIEW */}
      <section className="relative py-16">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-x-0 top-0 h-px bg-white/5" />
          <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,rgba(56,189,248,0.05),transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-transparent" />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            kicker="RESULTS"
            title="What improves when you respond instantly"
            desc="These are the exact categories you care about: speed-to-lead, booking rate, and time saved."
          />

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <StatCard value="5x" label="Faster response time" />
            <StatCard value="40%" label="More appointments booked" />
            <StatCard value="12hrs" label="Saved per week" />
          </div>

          <div className="mt-10 flex items-center justify-center gap-3">
            <Button asChild variant="outline">
              <Link href="/use-cases">
                View Solo Agents, Teams, Brokerages <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative py-16">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-x-0 top-0 h-px bg-white/5" />
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-transparent" />
        </div>

        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Ready to stop losing leads?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            If you are a fit, we map your lead source, install the system, and launch.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/apply">
                Book setup <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/features">See services</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
      <CookieBanner />
    </div>
  )
}
