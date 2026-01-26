"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CheckCircle2, X, ArrowRight } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

const plans = [
  {
    name: "Free Trial",
    description: "Try everything free for 14 days",
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      { name: "Up to 50 leads", included: true },
      { name: "Email & SMS automation", included: true },
      { name: "1 user", included: true },
      { name: "Basic templates", included: true },
      { name: "Community support", included: true },
      { name: "Advanced automations", included: false },
      { name: "Team features", included: false },
      { name: "API access", included: false },
    ],
    cta: "Start free trial",
    href: "/signup",
    popular: false,
  },
  {
    name: "Pro",
    description: "For individual agents who want to grow",
    monthlyPrice: 79,
    annualPrice: 63,
    features: [
      { name: "Unlimited leads", included: true },
      { name: "Email & SMS automation", included: true },
      { name: "1 user", included: true },
      { name: "Unlimited templates", included: true },
      { name: "Priority support", included: true },
      { name: "Advanced automations", included: true },
      { name: "Team features", included: false },
      { name: "API access", included: false },
    ],
    cta: "Start with Pro",
    href: "/signup?plan=pro",
    popular: true,
  },
  {
    name: "Team",
    description: "For teams and brokerages",
    monthlyPrice: 199,
    annualPrice: 159,
    features: [
      { name: "Unlimited leads", included: true },
      { name: "Email & SMS automation", included: true },
      { name: "Up to 10 users", included: true },
      { name: "Unlimited templates", included: true },
      { name: "Priority support", included: true },
      { name: "Advanced automations", included: true },
      { name: "Team features", included: true },
      { name: "API access", included: true },
    ],
    cta: "Start with Team",
    href: "/signup?plan=team",
    popular: false,
  },
]

const comparisonFeatures = [
  { name: "Leads", free: "50", pro: "Unlimited", team: "Unlimited" },
  { name: "Users", free: "1", pro: "1", team: "Up to 10" },
  { name: "Email automation", free: true, pro: true, team: true },
  { name: "SMS automation", free: true, pro: true, team: true },
  { name: "Templates", free: "5", pro: "Unlimited", team: "Unlimited" },
  { name: "Automations", free: "3", pro: "Unlimited", team: "Unlimited" },
  { name: "Lead routing", free: false, pro: true, team: true },
  { name: "Team dashboards", free: false, pro: false, team: true },
  { name: "API access", free: false, pro: false, team: true },
  { name: "White-label", free: false, pro: false, team: true },
  { name: "Support", free: "Community", pro: "Priority", team: "24/7 Priority" },
]

const faqs = [
  {
    question: "Can I switch plans later?",
    answer:
      "Yes! You can upgrade or downgrade your plan at any time. If you upgrade, you'll be prorated for the remaining time. If you downgrade, the change takes effect at your next billing cycle.",
  },
  {
    question: "What happens after my free trial?",
    answer:
      "Your trial includes full access to Pro features for 14 days. After that, you can choose to upgrade to a paid plan or continue with limited Free features.",
  },
  {
    question: "Do you offer discounts for annual billing?",
    answer: "Yes! You save 20% when you choose annual billing. That's like getting over 2 months free.",
  },
  {
    question: "Can I add more users to my Team plan?",
    answer:
      "Absolutely. Additional users beyond 10 are $15/user/month. Contact us for custom enterprise pricing for larger teams.",
  },
  {
    question: "Is there a setup fee?",
    answer: "No setup fees, no hidden costs. The price you see is the price you pay.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "We accept all major credit cards (Visa, Mastercard, American Express) and can arrange invoice billing for annual Team plans.",
  },
]

export default function PricingPage() {
  const [annual, setAnnual] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      {/* Hero */}
      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Simple, transparent <span className="text-primary">pricing</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Choose the plan that fits your business. No hidden fees, cancel anytime.
            </p>

            {/* Billing Toggle */}
            <div className="mt-8 flex items-center justify-center gap-3">
              <span className={`text-sm ${!annual ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
              <Switch checked={annual} onCheckedChange={setAnnual} />
              <span className={`text-sm ${annual ? "text-foreground" : "text-muted-foreground"}`}>Annual</span>
              {annual && (
                <span className="ml-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  Save 20%
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-3">
            {plans.map((plan, index) => (
              <Card
                key={index}
                className={`relative border-border bg-card transition-all duration-200 hover:border-primary/50 ${
                  plan.popular ? "ring-2 ring-primary" : ""
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-medium text-primary-foreground">
                    Most Popular
                  </div>
                )}
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl text-foreground">{plan.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-foreground">
                      ${annual ? plan.annualPrice : plan.monthlyPrice}
                    </span>
                    {plan.monthlyPrice > 0 && <span className="text-muted-foreground">/month</span>}
                  </div>
                  {plan.monthlyPrice > 0 && annual && (
                    <p className="text-sm text-muted-foreground">Billed annually (${plan.annualPrice * 12}/year)</p>
                  )}

                  <Button
                    className={`w-full ${plan.popular ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
                    variant={plan.popular ? "default" : "outline"}
                    asChild
                  >
                    <Link href={plan.href}>
                      {plan.cta}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>

                  <ul className="space-y-3">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-3">
                        {feature.included ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/50" />
                        )}
                        <span className={feature.included ? "text-muted-foreground" : "text-muted-foreground/50"}>
                          {feature.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="border-t border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="mb-12 text-center text-3xl font-bold text-foreground">Compare plans</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-4 text-left text-sm font-medium text-muted-foreground">Feature</th>
                  <th className="py-4 text-center text-sm font-medium text-muted-foreground">Free Trial</th>
                  <th className="py-4 text-center text-sm font-medium text-primary">Pro</th>
                  <th className="py-4 text-center text-sm font-medium text-muted-foreground">Team</th>
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((feature, index) => (
                  <tr key={index} className="border-b border-border">
                    <td className="py-4 text-sm text-foreground">{feature.name}</td>
                    <td className="py-4 text-center text-sm text-muted-foreground">
                      {typeof feature.free === "boolean" ? (
                        feature.free ? (
                          <CheckCircle2 className="mx-auto h-4 w-4 text-primary" />
                        ) : (
                          <X className="mx-auto h-4 w-4 text-muted-foreground/50" />
                        )
                      ) : (
                        feature.free
                      )}
                    </td>
                    <td className="py-4 text-center text-sm text-muted-foreground">
                      {typeof feature.pro === "boolean" ? (
                        feature.pro ? (
                          <CheckCircle2 className="mx-auto h-4 w-4 text-primary" />
                        ) : (
                          <X className="mx-auto h-4 w-4 text-muted-foreground/50" />
                        )
                      ) : (
                        feature.pro
                      )}
                    </td>
                    <td className="py-4 text-center text-sm text-muted-foreground">
                      {typeof feature.team === "boolean" ? (
                        feature.team ? (
                          <CheckCircle2 className="mx-auto h-4 w-4 text-primary" />
                        ) : (
                          <X className="mx-auto h-4 w-4 text-muted-foreground/50" />
                        )
                      ) : (
                        feature.team
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="mb-12 text-center text-3xl font-bold text-foreground">Frequently asked questions</h2>
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="rounded-lg border border-border bg-card px-6"
              >
                <AccordionTrigger className="text-left text-foreground hover:text-primary hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Contact Sales */}
      <section className="border-t border-border bg-card/50 py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-foreground">Need a custom plan?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            For brokerages with 10+ agents, we offer custom pricing, dedicated support, and enterprise features.
          </p>
          <Button size="lg" variant="outline" asChild className="mt-8 bg-transparent">
            <Link href="/contact">Contact sales</Link>
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  )
}
