import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CookieBanner } from "@/components/ui/cookie-banner"
import { ArrowRight, CheckCircle2 } from "lucide-react"

export default function ApplyPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Apply to install the RealtyTechAI system
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              This is not software access. We install and manage the system for you.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="text-xl font-semibold text-foreground">This is a fit if you:</h2>

              <ul className="mt-6 space-y-4">
                {[
                  "Generate online leads (Facebook, website, portals)",
                  "Want instant response and consistent follow-up",
                  "Are tired of manually chasing leads",
                  "Care more about booked appointments than dashboards",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-1 h-5 w-5 text-primary" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-10">
                <h3 className="text-lg font-semibold text-foreground">What happens next</h3>
                <ol className="mt-4 space-y-3 text-muted-foreground">
                  <li>1) You submit the application</li>
                  <li>2) We review fit and lead source</li>
                  <li>3) We map your install and launch</li>
                </ol>
              </div>
            </div>

            <Card className="border-border">
              <CardContent className="p-8">
                <h2 className="text-xl font-semibold text-foreground">Application</h2>

                <p className="mt-2 text-sm text-muted-foreground">
                  Answer honestly. This helps us launch faster.
                </p>

                <form
                  className="mt-8 space-y-4"
                  action="https://formsubmit.co/aiautomationsllc@gmail.com"
                  method="POST"
                >
                  <input type="hidden" name="_captcha" value="false" />
                  <input type="hidden" name="_subject" value="New RealtyTechAI Application" />
                  <input type="hidden" name="_template" value="table" />
                  <input type="hidden" name="_next" value="https://www.realtytechai.com/thanks" />

                  <input
                    required
                    name="name"
                    placeholder="Full name"
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                  />

                  <input
                    required
                    type="email"
                    name="email"
                    placeholder="Email address"
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                  />

                  <input
                    required
                    name="business"
                    placeholder="Business name"
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                  />

                  <input
                    required
                    name="lead_source"
                    placeholder="Primary lead source (Facebook, website, Zillow, etc.)"
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                  />

                  <textarea
                    required
                    name="goal"
                    placeholder="What do you want this system to improve?"
                    rows={4}
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                  />

                  <Button type="submit" className="mt-4 w-full">
                    Submit application
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>

                  <p className="pt-2 text-xs text-muted-foreground">
                    We review applications manually. Not everyone is accepted.
                  </p>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <Footer />
      <CookieBanner />
    </div>
  )
}
