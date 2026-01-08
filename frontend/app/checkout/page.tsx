"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Check, ArrowLeft, Lock, CreditCard, Shield, Building2 } from "lucide-react"

export default function CheckoutPage() {
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [isYearly, setIsYearly] = useState(true)

  const selectedPlan = {
    id: "professional",
    name: "Professional",
    price: 79,
    yearlyPrice: 790,
  }

  const [formData, setFormData] = useState({
    email: "",
    cardName: "",
    cardNumber: "",
    expiry: "",
    cvc: "",
    company: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "United States",
  })

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const handleSubmit = async () => {
    setProcessing(true)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setProcessing(false)
    window.location.href = "/app/dashboard"
  }

  const price = isYearly ? selectedPlan.yearlyPrice : selectedPlan.price * 12

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">RealtyTechAI</span>
          </Link>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            Secure Checkout
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          {/* Back Link */}
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to pricing
          </Link>

          <div className="grid gap-8 lg:grid-cols-5">
            {/* Checkout Form */}
            <div className="lg:col-span-3 space-y-6">
              <Card className="border-border bg-card">
                <CardContent className="p-6">
                  <h2 className="text-xl font-semibold text-foreground mb-6">Account Information</h2>
                  {loading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address</Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
                          placeholder="you@example.com"
                          className="bg-secondary"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="company">Company Name (Optional)</Label>
                        <Input
                          id="company"
                          value={formData.company}
                          onChange={(e) => setFormData((f) => ({ ...f, company: e.target.value }))}
                          placeholder="Your Company"
                          className="bg-secondary"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardContent className="p-6">
                  <h2 className="text-xl font-semibold text-foreground mb-6">Payment Details</h2>
                  {loading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <div className="grid grid-cols-2 gap-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="cardName">Name on Card</Label>
                        <Input
                          id="cardName"
                          value={formData.cardName}
                          onChange={(e) => setFormData((f) => ({ ...f, cardName: e.target.value }))}
                          placeholder="Jane Doe"
                          className="bg-secondary"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cardNumber">Card Number</Label>
                        <div className="relative">
                          <Input
                            id="cardNumber"
                            value={formData.cardNumber}
                            onChange={(e) => setFormData((f) => ({ ...f, cardNumber: e.target.value }))}
                            placeholder="1234 5678 9012 3456"
                            className="bg-secondary pl-10"
                          />
                          <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="expiry">Expiry</Label>
                          <Input
                            id="expiry"
                            value={formData.expiry}
                            onChange={(e) => setFormData((f) => ({ ...f, expiry: e.target.value }))}
                            placeholder="MM/YY"
                            className="bg-secondary"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="cvc">CVC</Label>
                          <Input
                            id="cvc"
                            value={formData.cvc}
                            onChange={(e) => setFormData((f) => ({ ...f, cvc: e.target.value }))}
                            placeholder="123"
                            className="bg-secondary"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardContent className="p-6">
                  <h2 className="text-xl font-semibold text-foreground mb-6">Billing Address</h2>
                  {loading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-10 w-full" />
                      <div className="grid grid-cols-2 gap-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="address">Street Address</Label>
                        <Input
                          id="address"
                          value={formData.address}
                          onChange={(e) => setFormData((f) => ({ ...f, address: e.target.value }))}
                          placeholder="123 Main St"
                          className="bg-secondary"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="city">City</Label>
                          <Input
                            id="city"
                            value={formData.city}
                            onChange={(e) => setFormData((f) => ({ ...f, city: e.target.value }))}
                            placeholder="New York"
                            className="bg-secondary"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="state">State</Label>
                          <Input
                            id="state"
                            value={formData.state}
                            onChange={(e) => setFormData((f) => ({ ...f, state: e.target.value }))}
                            placeholder="NY"
                            className="bg-secondary"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="zip">ZIP Code</Label>
                          <Input
                            id="zip"
                            value={formData.zip}
                            onChange={(e) => setFormData((f) => ({ ...f, zip: e.target.value }))}
                            placeholder="10001"
                            className="bg-secondary"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="country">Country</Label>
                          <Input id="country" value={formData.country} disabled className="bg-secondary" />
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-2">
              <Card className="border-border bg-card sticky top-8">
                <CardContent className="p-6">
                  <h2 className="text-lg font-semibold text-foreground mb-4">Order Summary</h2>

                  {/* Billing Toggle */}
                  <div className="flex items-center gap-2 bg-secondary rounded-lg p-1 mb-6">
                    <button
                      className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        !isYearly ? "bg-background text-foreground shadow" : "text-muted-foreground"
                      }`}
                      onClick={() => setIsYearly(false)}
                    >
                      Monthly
                    </button>
                    <button
                      className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isYearly ? "bg-background text-foreground shadow" : "text-muted-foreground"
                      }`}
                      onClick={() => setIsYearly(true)}
                    >
                      Yearly
                    </button>
                  </div>

                  {loading ? (
                    <Skeleton className="h-32 w-full" />
                  ) : (
                    <>
                      <div className="p-4 rounded-lg bg-secondary/50 mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-foreground">{selectedPlan.name}</span>
                          <Badge className="bg-primary/10 text-primary">Popular</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">Best for growing teams</p>
                      </div>

                      <div className="space-y-2 mb-4 pb-4 border-b border-border">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {selectedPlan.name} ({isYearly ? "Yearly" : "Monthly"})
                          </span>
                          <span className="text-foreground">${price.toFixed(2)}</span>
                        </div>
                        {isYearly && (
                          <div className="flex justify-between text-sm">
                            <span className="text-green-500">Savings</span>
                            <span className="text-green-500">
                              -${(selectedPlan.price * 12 - selectedPlan.yearlyPrice).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-between text-lg font-semibold mb-6">
                        <span className="text-foreground">Total</span>
                        <span className="text-foreground">${price.toFixed(2)}</span>
                      </div>

                      <Button
                        className="w-full"
                        size="lg"
                        onClick={handleSubmit}
                        disabled={processing || !formData.email || !formData.cardNumber}
                      >
                        {processing ? (
                          "Processing..."
                        ) : (
                          <>
                            <Lock className="h-4 w-4 mr-2" />
                            Subscribe Now
                          </>
                        )}
                      </Button>

                      <div className="mt-4 space-y-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Shield className="h-4 w-4 text-green-500" />
                          30-day money-back guarantee
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Check className="h-4 w-4 text-green-500" />
                          Cancel anytime
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Lock className="h-4 w-4 text-green-500" />
                          256-bit SSL encryption
                        </div>
                      </div>

                      <p className="text-xs text-center text-muted-foreground mt-6">
                        By subscribing, you agree to our{" "}
                        <Link href="/terms" className="text-primary hover:underline">
                          Terms of Service
                        </Link>{" "}
                        and{" "}
                        <Link href="/privacy" className="text-primary hover:underline">
                          Privacy Policy
                        </Link>
                        .
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} RealtyTechAI LLC. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
