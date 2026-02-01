import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CookieBanner } from "@/components/ui/cookie-banner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowRight, Clock, Shield, Zap, Mail } from "lucide-react"

function InfoRow({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
    </div>
  )
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="relative border-b border-border">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(900px_circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(700px_circle_at_80%_0%,rgba(59,130,246,0.12),transparent_45%)]" />
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Contact</h1>
            <p className="mt-4 text-base text-muted-foreground">
              Demos, install requests, or questions. If you are a fit, we move fast.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/apply">
                  Apply to install <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="mailto:aiautomationsllc@gmail.com">
                  Email us <Mail className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            <div className="space-y-6">
              <Card className="border-border bg-card/60">
                <CardContent className="p-8">
                  <div className="text-lg font-semibold text-foreground">What you get</div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    We install a speed-to-lead + follow-up system that keeps working until leads book or go cold.
                  </p>

                  <div className="mt-6 space-y-5">
                    <InfoRow icon={<Zap className="h-5 w-5" />} title="Fast setup" desc="We map your lead source and launch in days, not months." />
                    <InfoRow icon={<Clock className="h-5 w-5" />} title="Manual review" desc="We respond personally and qualify fit before installing." />
                    <InfoRow icon={<Shield className="h-5 w-5" />} title="You control your workflow" desc="Your process, your messaging, your rules." />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border bg-card/60">
                <CardContent className="p-8">
                  <div className="text-sm font-semibold text-foreground">Best way to start</div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    If you want the fastest path to install, use the application.
                  </p>
                  <div className="mt-5">
                    <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                      <Link href="/apply">
                        Apply Now <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border">
              <CardContent className="p-8">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Send a message</h2>
                  <p className="mt-1 text-sm text-muted-foreground">We will reply to the email you provide.</p>
                </div>

                <form
                  className="mt-8 space-y-4"
                  action="https://formsubmit.co/aiautomationsllc@gmail.com"
                  method="POST"
                >
                  <input type="hidden" name="_captcha" value="false" />
                  <input type="hidden" name="_template" value="table" />
                  <input type="hidden" name="_subject" value="New Contact — RealtyTechAI" />
                  <input type="hidden" name="_next" value="https://www.realtytechai.com/thanks" />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <input
                      required
                      name="name"
                      placeholder="Full name"
                      className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                    <input
                      required
                      type="email"
                      name="email"
                      placeholder="Email address"
                      className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <input
                      name="company"
                      placeholder="Company (optional)"
                      className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                    <select
                      name="topic"
                      defaultValue="Install"
                      className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                    >
                      <option value="Install">Install request</option>
                      <option value="Demo">Demo</option>
                      <option value="Question">Question</option>
                      <option value="Support">Support</option>
                    </select>
                  </div>

                  <textarea
                    required
                    name="message"
                    placeholder="Tell us your lead source and what you want to improve."
                    rows={6}
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
                  />

                  <div className="pt-2">
                    <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                      Send message <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      No self-signup. Client access is granted after approval.
                    </p>
                  </div>
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
