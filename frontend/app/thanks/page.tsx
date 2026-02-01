import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CookieBanner } from "@/components/ui/cookie-banner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, ArrowRight } from "lucide-react"

export default function ThanksPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="relative border-b border-border">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(900px_circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(700px_circle_at_80%_0%,rgba(59,130,246,0.12),transparent_45%)]" />
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Submitted
            </h1>
            <p className="mt-4 text-base text-muted-foreground">
              We got your message. If you are a fit, we will reply with next steps.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <Card className="border-border">
            <CardContent className="p-8">
              <div className="grid gap-6 md:grid-cols-2 md:items-start">
                <div>
                  <div className="text-sm font-semibold text-foreground">What happens next</div>
                  <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>1) We review your lead source and volume</li>
                    <li>2) If you are a fit, we email you to book a short call</li>
                    <li>3) We map the install and launch</li>
                  </ol>
                </div>

                <div className="rounded-xl border border-border bg-card/60 p-5">
                  <div className="text-sm font-semibold text-foreground">Quick tip</div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    If you submitted an install request, include your lead source, average monthly lead volume,
                    and your market. That speeds everything up.
                  </p>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Link href="/">
                    Back to home <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/contact">Send another message</Link>
                </Button>
              </div>

              <p className="mt-6 text-xs text-muted-foreground">
                Client access is granted after approval. No self-signup.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <Footer />
      <CookieBanner />
    </div>
  )
}
