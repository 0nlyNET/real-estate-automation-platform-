import Link from "next/link"
import { Button } from "@/components/ui/button"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { Zap, MessageSquare, Calendar, BarChart3, ArrowRight, Bot, FileText } from "lucide-react"

const featureCategories = [
  {
    title: "Speed-to-Lead",
    description: "Queue approved outreach promptly after an eligible lead is captured.",
    icon: Zap,
    features: [
      "Lead capture from configured sources",
      "Queued automated responses",
      "Source-aware team and fixed-user routing",
      "Quiet-hours controls",
    ],
    screenshot: "/lead-capture-dashboard-dark-theme.jpg",
  },
  {
    title: "Unified Inbox",
    description: "Review supported channel history in one workspace.",
    icon: MessageSquare,
    features: [
      "Threaded conversations across channels",
      "SMS and email conversation history",
      "Lead tagging and assignment",
      "Provider delivery status where available",
    ],
    screenshot: "/inbox-conversations-dark-theme.jpg",
  },
  {
    title: "Automation Engine",
    description: "Run approved linear follow-up under human and compliance controls.",
    icon: Bot,
    features: [
      "Editable follow-up sequences",
      "Time-delay and trigger-based sequences",
      "Pause, resume, and stop controls",
      "Opt-out and reply-based stopping",
    ],
    screenshot: "/automation-workflow-builder-dark-theme.jpg",
  },
  {
    title: "Booking links",
    description: "Include a configured external booking link in approved follow-up.",
    icon: Calendar,
    features: [
      "Share a configured booking link",
      "Include booking links in follow-up sequences",
      "Keep appointment calls to action consistent",
      "Manage the link from tenant settings",
    ],
    screenshot: "/calendar-booking-interface-dark-theme.jpg",
  },
  {
    title: "Smart Reporting",
    description: "Review defined lead, provider-state, reply, and pipeline metrics.",
    icon: BarChart3,
    features: [
      "Response time tracking",
      "Lead-stage counts",
      "Lead source counts",
      "Agent-scoped overview metrics",
    ],
    screenshot: "/analytics-dashboard-charts-dark-theme.jpg",
  },
  {
    title: "Template Library",
    description: "Never write the same message twice.",
    icon: FileText,
    features: [
      "Dynamic variable insertion",
      "Reusable SMS and email content",
      "Sequence-level message steps",
      "Centralized editing for administrators",
    ],
    screenshot: "/message-templates-library-dark-theme.jpg",
  },
]

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      {/* Hero */}
      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Powerful features for <span className="text-primary">modern agents</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Current capabilities for managed intake, approved follow-up, shared history, and basic reporting.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="space-y-32">
            {featureCategories.map((category, index) => (
              <div
                key={index}
                className={`flex flex-col gap-12 lg:flex-row lg:items-center ${
                  index % 2 === 1 ? "lg:flex-row-reverse" : ""
                }`}
              >
                <div className="flex-1 space-y-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <category.icon className="h-6 w-6" />
                  </div>
                  <h2 className="text-3xl font-bold text-foreground">{category.title}</h2>
                  <p className="text-lg text-muted-foreground">{category.description}</p>
                  <ul className="space-y-3">
                    {category.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                          <Zap className="h-3 w-3 text-primary" />
                        </div>
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex-1">
                  <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                    <img
                      src={category.screenshot}
                      alt={category.title}
                      className="h-auto w-full"
                    />
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
          <h2 className="text-3xl font-bold text-foreground">Ready to see it in action?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Apply for a supervised paid pilot and review the exact service scope before checkout.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/apply">
                Apply for pilot
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/apply">Request a demo</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
