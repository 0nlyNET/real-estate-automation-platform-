"use client"

import { useState } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Check, ArrowLeft, Lock, CreditCard, Shield } from "lucide-react"
import Link from "next/link"

const plans = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    yearlyPrice: 290,
    description: "Perfect for solo agents",
    features: ["Up to 500 leads", "3 automations", "Email support", "Basic templates"],
  },
  {
    id: "professional",
    name: "Professional",
    price: 79,
    yearlyPrice: 790,
    description: "For growing teams",
    features: [
      "Up to 5,000 leads",
      "Unlimited automations",
      "Priority support",
      "Advanced templates",
      "All integrations",
      "Team collaboration (3 users)",
    ],
    popular: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 199,
    yearlyPrice: 1990,
    description: "For brokerages",
    features: [
      "Unlimited leads",
      "Unlimited automations",
      "Dedicated support",
      "Custom templates",
      "Premium integrations",
      "Unlimited team members",
      "White-label options",
      "API access",
    ],
  },
]

export default function UpgradePage() {
  const { toast } = useToast()
  const [isYearly, setIsYearly] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState(plans[1])
  const [step, setStep] = useState<"plan" | "checkout">("plan")
  const [processing, setProcessing] = useState(false)

  const [cardDetails, setCardDetails] = useState({
    number: "",
    expiry: "",
    cvc: "",
    name: "",
  })

  const handlePlanSelect = (plan: (typeof plans)[0]) => {
    setSelectedPlan(plan)
  }

  const handleProceedToCheckout = () => {
    setStep("checkout")
  }

  const handleSubmit = async () => {
    setProcessing(true)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setProcessing(false)
    toast({
      title: "Upgrade successful!",
      description: `You're now on the ${selectedPlan.name} plan.`,
    })
  }

  const price = isYearly ? selectedPlan.yearlyPrice : selectedPlan.price * 12
  const monthlyPrice = isYearly ? Math.round(selectedPlan.yearlyPrice / 12) : selectedPlan.price

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/app/billing">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {step === "plan" ? "Choose Your Plan" : "Complete Your Upgrade"}
            </h1>
            <p className="text-muted-foreground">
              {step === "plan" ? "Select the plan that works best for you." : "Enter your payment details."}
            </p>
          </div>
        </div>

        {step === "plan" ? (
          <>
            {/* Billing Toggle */}
            <div className="flex justify-center">
              <div className="flex items-center gap-2 bg-secondary rounded-lg p-1">
                <button
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    !isYearly ? "bg-background text-foreground shadow" : "text-muted-foreground"
                  }`}
                  onClick={() => setIsYearly(false)}
                >
                  Monthly
                </button>
                <button
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    isYearly ? "bg-background text-foreground shadow" : "text-muted-foreground"
                  }`}
                  onClick={() => setIsYearly(true)}
                >
                  Yearly
                  <span className="ml-2 text-xs text-green-500">Save 17%</span>
                </button>
              </div>
            </div>

            {/* Plans Grid */}
            <div className="grid gap-6 md:grid-cols-3">
              {plans.map((plan) => (
                <Card
                  key={plan.id}
                  className={`relative cursor-pointer transition-all ${
                    selectedPlan.id === plan.id
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border hover:border-primary/50"
                  } ${plan.popular ? "bg-primary/5" : "bg-card"}`}
                  onClick={() => handlePlanSelect(plan)}
                >
                  {plan.popular && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                      Most Popular
                    </Badge>
                  )}
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>
                      <div
                        className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                          selectedPlan.id === plan.id ? "border-primary bg-primary" : "border-muted-foreground"
                        }`}
                      >
                        {selectedPlan.id === plan.id && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                    </div>

                    <div className="mt-4">
                      <span className="text-4xl font-bold text-foreground">
                        ${isYearly ? Math.round(plan.yearlyPrice / 12) : plan.price}
                      </span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                    {isYearly && <p className="text-sm text-green-500 mt-1">Billed ${plan.yearlyPrice}/year</p>}

                    <p className="text-muted-foreground mt-3">{plan.description}</p>

                    <ul className="mt-6 space-y-3">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="text-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Continue Button */}
            <div className="flex justify-center pt-4">
              <Button size="lg" onClick={handleProceedToCheckout} className="px-8">
                Continue with {selectedPlan.name}
              </Button>
            </div>
          </>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Order Summary */}
            <Card className="border-border bg-card order-2 lg:order-1">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">Order Summary</h2>

                <div className="p-4 rounded-lg bg-secondary/50 mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-foreground">{selectedPlan.name} Plan</span>
                    {selectedPlan.popular && <Badge className="bg-primary/10 text-primary">Popular</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{selectedPlan.description}</p>
                </div>

                <div className="space-y-3 mb-6">
                  {selectedPlan.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary" />
                      <span className="text-foreground">{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border pt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="text-foreground">${price.toFixed(2)}</span>
                  </div>
                  {isYearly && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-green-500">Annual discount (17%)</span>
                      <span className="text-green-500">
                        -${(selectedPlan.price * 12 - selectedPlan.yearlyPrice).toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-lg font-semibold pt-2 border-t border-border">
                    <span className="text-foreground">Total</span>
                    <span className="text-foreground">
                      ${price.toFixed(2)}/{isYearly ? "year" : "month"}
                    </span>
                  </div>
                </div>

                <div className="mt-6 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <p className="text-sm text-green-500 flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    30-day money-back guarantee
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Payment Form */}
            <Card className="border-border bg-card order-1 lg:order-2">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">Payment Details</h2>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="cardName">Name on Card</Label>
                    <Input
                      id="cardName"
                      value={cardDetails.name}
                      onChange={(e) => setCardDetails((c) => ({ ...c, name: e.target.value }))}
                      placeholder="Jane Doe"
                      className="bg-secondary"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cardNumber">Card Number</Label>
                    <div className="relative">
                      <Input
                        id="cardNumber"
                        value={cardDetails.number}
                        onChange={(e) => setCardDetails((c) => ({ ...c, number: e.target.value }))}
                        placeholder="1234 5678 9012 3456"
                        className="bg-secondary pl-10"
                      />
                      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="expiry">Expiry Date</Label>
                      <Input
                        id="expiry"
                        value={cardDetails.expiry}
                        onChange={(e) => setCardDetails((c) => ({ ...c, expiry: e.target.value }))}
                        placeholder="MM/YY"
                        className="bg-secondary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cvc">CVC</Label>
                      <Input
                        id="cvc"
                        value={cardDetails.cvc}
                        onChange={(e) => setCardDetails((c) => ({ ...c, cvc: e.target.value }))}
                        placeholder="123"
                        className="bg-secondary"
                      />
                    </div>
                  </div>

                  <Button
                    className="w-full mt-6"
                    size="lg"
                    onClick={handleSubmit}
                    disabled={processing || !cardDetails.name || !cardDetails.number}
                  >
                    {processing ? (
                      "Processing..."
                    ) : (
                      <>
                        <Lock className="h-4 w-4 mr-2" />
                        Pay ${price.toFixed(2)} {isYearly ? "/ year" : "/ month"}
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground mt-4">
                    Your payment is secured with 256-bit SSL encryption.
                  </p>
                </div>

                <div className="mt-6 pt-6 border-t border-border">
                  <Button variant="ghost" className="w-full" onClick={() => setStep("plan")}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to plan selection
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  )
}
