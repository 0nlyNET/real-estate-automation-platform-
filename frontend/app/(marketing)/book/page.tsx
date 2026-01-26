import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

const bookingUrl = process.env.NEXT_PUBLIC_BOOKING_URL

export default function BookPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Book a call</h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Pick a time that works and we will walk through your current lead response process.
            </p>
          </div>

          <div className="mt-12 overflow-hidden rounded-2xl border border-border bg-card">
            {bookingUrl ? (
              <iframe
                src={bookingUrl}
                title="Booking"
                className="h-[720px] w-full"
                allow="camera; microphone; fullscreen; payment"
              />
            ) : (
              <div className="space-y-4 p-12 text-center">
                <p className="text-lg font-semibold text-foreground">Booking link not configured.</p>
                <p className="text-sm text-muted-foreground">
                  Set NEXT_PUBLIC_BOOKING_URL to embed your scheduling page, or reach us at{" "}
                  <a className="text-primary underline" href="mailto:hello@realtytechai.com">
                    hello@realtytechai.com
                  </a>
                  .
                </p>
                <p className="text-sm text-muted-foreground">
                  Prefer a quick form? <Link className="text-primary underline" href="/contact">Contact us</Link>.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
