import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { ArrowRight, Target, Heart, Zap } from "lucide-react"

const team = [
  {
    name: "Alex Rivera",
    role: "CEO & Co-founder",
    image: "/professional-headshot-ceo-male.jpg",
  },
  {
    name: "Sarah Chen",
    role: "CTO & Co-founder",
    image: "/professional-headshot-cto-female.jpg",
  },
  {
    name: "Marcus Johnson",
    role: "Head of Product",
    image: "/professional-headshot-product-male.jpg",
  },
  {
    name: "Emily Park",
    role: "Head of Customer Success",
    image: "/professional-headshot-success-female.jpg",
  },
]

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
              We're on a mission to help real estate professionals close more deals with less effort.
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
                RealtyTechAI was born from a simple observation: in real estate, the first agent to respond usually wins
                the deal. Yet most agents were losing leads simply because they couldn't respond fast enough.
              </p>
              <p>
                Our founders, both coming from real estate families, experienced this problem firsthand. They watched
                talented agents lose deals to competitors who happened to be near their phone at the right moment.
              </p>
              <p>
                In 2022, they set out to build a solution. Not just another CRM, but a true automation platform that
                could respond to leads instantly, nurture them automatically, and book appointments without manual
                intervention.
              </p>
              <p>
                Today, RealtyTechAI powers thousands of agents and teams across North America, helping them respond
                faster, follow up consistently, and close more deals.
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

      {/* Team */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-foreground">Meet our team</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            A passionate group of builders, real estate enthusiasts, and automation nerds.
          </p>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {team.map((member, index) => (
              <Card key={index} className="border-border bg-card overflow-hidden">
                <img src={member.image || "/placeholder.svg"} alt={member.name} className="h-48 w-full object-cover" />
                <CardContent className="p-4 text-center">
                  <h3 className="font-semibold text-foreground">{member.name}</h3>
                  <p className="text-sm text-muted-foreground">{member.role}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-foreground">Join us on our mission</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            We're always looking for talented people who want to make a difference in real estate tech.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/signup">
                Start free trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/contact">View open positions</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
