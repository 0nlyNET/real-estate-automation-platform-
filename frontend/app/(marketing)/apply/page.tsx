"use client"

import Link from "next/link"
import { useState } from "react"
import type { ChangeEvent, FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { apiFetch } from "@/lib/api"

const initialForm = {
  fullName: "",
  email: "",
  phone: "",
  company: "",
  teamSize: "",
  leadSources: "",
  notes: "",
}

export default function ApplyPage() {
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await apiFetch<{ id: string; status: string }>("/public/applications", {
        method: "POST",
        json: {
          ...form,
          sourcePage: typeof window !== "undefined" ? window.location.href : undefined,
        },
      })
      setSuccess(true)
      setForm(initialForm)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Apply to work with us</h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Share a few details about your team and we will review the fit within 48 hours.
            </p>
          </div>

          <div className="mt-12">
            <Card className="border-border bg-card">
              <CardContent className="p-8">
                {success ? (
                  <div className="space-y-4 text-center">
                    <h2 className="text-2xl font-semibold text-foreground">Application received!</h2>
                    <p className="text-sm text-muted-foreground">
                      We will review your details and follow up within 48 hours. You can also book a call now.
                    </p>
                    <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                      <Link href="/book">Book a call</Link>
                    </Button>
                  </div>
                ) : (
                  <form className="space-y-6" onSubmit={handleSubmit}>
                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="fullName">
                          Full name
                        </label>
                        <input
                          id="fullName"
                          name="fullName"
                          required
                          value={form.fullName}
                          onChange={handleChange}
                          className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="email">
                          Email
                        </label>
                        <input
                          id="email"
                          type="email"
                          name="email"
                          required
                          value={form.email}
                          onChange={handleChange}
                          className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="phone">
                          Phone
                        </label>
                        <input
                          id="phone"
                          name="phone"
                          value={form.phone}
                          onChange={handleChange}
                          className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="company">
                          Company
                        </label>
                        <input
                          id="company"
                          name="company"
                          required
                          value={form.company}
                          onChange={handleChange}
                          className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="teamSize">
                          Team size
                        </label>
                        <input
                          id="teamSize"
                          name="teamSize"
                          value={form.teamSize}
                          onChange={handleChange}
                          className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="leadSources">
                          Lead sources
                        </label>
                        <input
                          id="leadSources"
                          name="leadSources"
                          value={form.leadSources}
                          onChange={handleChange}
                          className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground" htmlFor="notes">
                        Notes
                      </label>
                      <textarea
                        id="notes"
                        name="notes"
                        rows={5}
                        value={form.notes}
                        onChange={handleChange}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    <Button
                      type="submit"
                      size="lg"
                      disabled={submitting}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {submitting ? "Submitting..." : "Submit application"}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
