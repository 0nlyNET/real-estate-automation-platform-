"use client"

import { FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { ArrowRight, CheckCircle2 } from "lucide-react"
import { apiFetch } from "@/lib/api"

export default function ApplyPage() {
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setResult(null)

    const formElement = event.currentTarget
    const form = new FormData(formElement)
    try {
      const response = await apiFetch<{ message?: string }>("/public/inquiry", {
        method: "POST",
        body: {
          name: String(form.get("name") || ""),
          email: String(form.get("email") || ""),
          company: String(form.get("business") || ""),
          phone: String(form.get("phone") || ""),
          website: String(form.get("website") || "") || undefined,
          estimatedMonthlyLeadVolume: Number(form.get("lead_volume") || 0),
          requestedService: String(form.get("requested_service") || ""),
          topic: "setup",
          source: String(form.get("lead_source") || ""),
          message: String(form.get("goal") || ""),
          websiteConfirmation: String(form.get("website_confirmation") || ""),
        },
      })
      formElement.reset()
      setResult(response.message || "Your application was received. Our team will review it and contact you using the information provided.")
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Application could not be submitted.")
    } finally {
      setSubmitting(false)
    }
  }

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
                  "Want prompt, approved response and consistent follow-up",
                  "Are tired of manually chasing leads",
                  "Want observable lead handling rather than unsupported outcome claims",
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
                  These details help us plan the pilot scope accurately.
                </p>

                <form className="mt-8 space-y-4" onSubmit={submitApplication}>
                  <input name="website_confirmation" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
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
                    name="phone"
                    type="tel"
                    placeholder="Phone number"
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                  />

                  <input
                    name="website"
                    type="url"
                    placeholder="Website (https://…)"
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                  />

                  <input
                    required
                    name="lead_volume"
                    type="number"
                    min="0"
                    placeholder="Estimated monthly lead volume"
                    className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
                  />

                  <select required name="requested_service" defaultValue="" className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground">
                    <option value="" disabled>Requested service</option>
                    <option value="managed-pilot">Managed paid pilot</option>
                    <option value="sms-email-follow-up">SMS and email follow-up</option>
                    <option value="lead-intake-routing">Lead intake and routing</option>
                    <option value="consultation">Fit consultation</option>
                  </select>

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

                  <Button type="submit" className="mt-4 w-full" disabled={submitting}>
                    {submitting ? "Submitting..." : "Submit application"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>

                  {result ? <p role="status" className="text-sm text-muted-foreground">{result}</p> : null}

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
    </div>
  )
}
