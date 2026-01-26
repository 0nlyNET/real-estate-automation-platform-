import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

const caseStudies = [
  {
    title: "Midtown Realty",
    summary: "Cut response time to 45 seconds and doubled appointments booked.",
    industry: "12-agent team",
  },
  {
    title: "Harbor Group",
    summary: "Automated lead routing across 4 offices with consistent follow-up.",
    industry: "Brokerage",
  },
  {
    title: "Solis Properties",
    summary: "Recovered 28% more leads with multi-channel nurture sequences.",
    industry: "Luxury team",
  },
]

export default function CaseStudiesPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Case studies</h1>
            <p className="mt-6 text-lg text-muted-foreground">
              A few examples of the systems we install and the outcomes we deliver.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 md:grid-cols-3">
            {caseStudies.map((item) => (
              <Card key={item.title} className="border-border bg-card">
                <CardContent className="space-y-3 p-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">{item.industry}</p>
                  <h2 className="text-xl font-semibold text-foreground">{item.title}</h2>
                  <p className="text-sm text-muted-foreground">{item.summary}</p>
                  <p className="text-xs text-muted-foreground">Full story coming soon.</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-foreground">Want similar results?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Book a call and we will map the fastest path to a faster follow-up system.
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
