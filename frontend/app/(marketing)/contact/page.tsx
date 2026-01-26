import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Contact</h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Email us directly or use the links below to get started.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Card className="border-border bg-card">
              <CardContent className="space-y-3 p-6">
                <p className="text-sm font-medium text-foreground">Email</p>
                <a className="text-sm text-primary underline" href="mailto:hello@realtytechai.com">
                  hello@realtytechai.com
                </a>
                <p className="text-xs text-muted-foreground">We respond within one business day.</p>
              </CardContent>
            </Card>
            <Card className="border-border bg-card">
              <CardContent className="space-y-4 p-6">
                <p className="text-sm font-medium text-foreground">Next steps</p>
                <div className="flex flex-col gap-3">
                  <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Link href="/book">Book a call</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/apply">Apply to work with us</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
