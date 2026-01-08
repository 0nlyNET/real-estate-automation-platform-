"use client"

import { useState, useEffect } from "react"
import { AppShell } from "@/components/app-shell/app-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Check, Zap, Users, ArrowRight, CreditCard, AlertTriangle, Download } from "lucide-react"
import Link from "next/link"

const plans = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    yearlyPrice: 290,
    description: "Perfect for solo agents getting started",
    features: ["Up to 500 leads", "3 automations", "Email support", "Basic templates", "Standard integrations"],
    limits: { leads: 500, automations: 3, teamMembers: 1 },
  },
  {
    id: "professional",
    name: "Professional",
    price: 79,
    yearlyPrice: 790,
    description: "For growing teams and serious agents",
    features: [
      "Up to 5,000 leads",
      "Unlimited automations",
      "Priority support",
      "Advanced templates",
      "All integrations",
      "Team collaboration (3 users)",
      "Custom branding",
    ],
    limits: { leads: 5000, automations: -1, teamMembers: 3 },
    popular: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 199,
    yearlyPrice: 1990,
    description: "For brokerages and large teams",
    features: [
      "Unlimited leads",
      "Unlimited automations",
      "Dedicated support",
      "Custom templates",
      "Premium integrations",
      "Unlimited team members",
      "White-label options",
      "API access",
      "SLA guarantee",
    ],
    limits: { leads: -1, automations: -1, teamMembers: -1 },
  },
]

const invoices = [
  { id: "INV-2026-001", date: "Jan 15, 2026", amount: 29.0, status: "paid" },
  { id: "INV-2025-012", date: "Dec 15, 2025", amount: 29.0, status: "paid" },
  { id: "INV-2025-011", date: "Nov 15, 2025", amount: 29.0, status: "paid" },
  { id: "INV-2025-010", date: "Oct 15, 2025", amount: 29.0, status: "paid" },
  { id: "INV-2025-009", date: "Sep 15, 2025", amount: 29.0, status: "paid" },
]

export default function BillingPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [isYearly, setIsYearly] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<(typeof plans)[0] | null>(null)

  const currentPlan = plans[0]
  const usage = {
    leads: 324,
    automations: 2,
    teamMembers: 1,
  }

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  const handleUpgrade = (plan: (typeof plans)[0]) => {
    setSelectedPlan(plan)
    setUpgradeDialogOpen(true)
  }

  const handleConfirmUpgrade = () => {
    setUpgradeDialogOpen(false)
    toast({
      title: "Upgrade initiated",
      description: "Redirecting to checkout...",
    })
    // Would redirect to checkout
  }

  const handleCancelSubscription = () => {
    setCancelDialogOpen(false)
    toast({
      title: "Subscription cancelled",
      description: "Your plan will remain active until Feb 15, 2026.",
    })
  }

  const getUsagePercentage = (used: number, limit: number) => {
    if (limit === -1) return 0
    return Math.min((used / limit) * 100, 100)
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Billing</h1>
          <p className="text-muted-foreground">Manage your subscription and billing details.</p>
        </div>

        {/* Current Plan */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription>Your subscription details and usage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-semibold text-foreground">{currentPlan.name} Plan</h3>
                      <Badge className="bg-primary/20 text-primary">Active</Badge>
                    </div>
                    <p className="text-muted-foreground mt-1">${currentPlan.price}/month • Renews on Feb 15, 2026</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="bg-transparent" onClick={() => setCancelDialogOpen(true)}>
                      Cancel Plan
                    </Button>
                    <Link href="/app/billing/upgrade">
                      <Button>
                        <Zap className="h-4 w-4 mr-2" />
                        Upgrade
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Usage */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="p-4 rounded-lg bg-secondary/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Leads</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {usage.leads} / {currentPlan.limits.leads}
                      </span>
                    </div>
                    <Progress value={getUsagePercentage(usage.leads, currentPlan.limits.leads)} className="h-2" />
                    {getUsagePercentage(usage.leads, currentPlan.limits.leads) > 80 && (
                      <p className="text-xs text-yellow-500 mt-2">Approaching limit</p>
                    )}
                  </div>

                  <div className="p-4 rounded-lg bg-secondary/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Automations</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {usage.automations} / {currentPlan.limits.automations}
                      </span>
                    </div>
                    <Progress
                      value={getUsagePercentage(usage.automations, currentPlan.limits.automations)}
                      className="h-2"
                    />
                  </div>

                  <div className="p-4 rounded-lg bg-secondary/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Team Members</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {usage.teamMembers} / {currentPlan.limits.teamMembers}
                      </span>
                    </div>
                    <Progress
                      value={getUsagePercentage(usage.teamMembers, currentPlan.limits.teamMembers)}
                      className="h-2"
                    />
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Quick Upgrade Options */}
        <Card className="border-border bg-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Upgrade Your Plan</CardTitle>
                <CardDescription>Unlock more features and capacity.</CardDescription>
              </div>
              <div className="flex items-center gap-2 bg-secondary rounded-lg p-1">
                <button
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    !isYearly ? "bg-background text-foreground shadow" : "text-muted-foreground"
                  }`}
                  onClick={() => setIsYearly(false)}
                >
                  Monthly
                </button>
                <button
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    isYearly ? "bg-background text-foreground shadow" : "text-muted-foreground"
                  }`}
                  onClick={() => setIsYearly(true)}
                >
                  Yearly
                  <span className="ml-1 text-xs text-green-500">Save 17%</span>
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-64 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                {plans.map((plan) => (
                  <div
                    key={plan.id}
                    className={`relative p-5 rounded-lg border transition-all ${
                      plan.popular ? "border-primary bg-primary/5" : "border-border bg-secondary/30"
                    } ${plan.id === currentPlan.id ? "opacity-50" : "hover:border-primary/50"}`}
                  >
                    {plan.popular && (
                      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                        Most Popular
                      </Badge>
                    )}
                    <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                    <div className="mt-2">
                      <span className="text-3xl font-bold text-foreground">
                        ${isYearly ? Math.round(plan.yearlyPrice / 12) : plan.price}
                      </span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                    {isYearly && <p className="text-sm text-green-500 mt-1">Billed ${plan.yearlyPrice}/year</p>}
                    <p className="text-sm text-muted-foreground mt-2">{plan.description}</p>
                    <ul className="mt-4 space-y-2">
                      {plan.features.slice(0, 4).map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="text-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full mt-4"
                      variant={plan.id === currentPlan.id ? "outline" : "default"}
                      disabled={plan.id === currentPlan.id}
                      onClick={() => handleUpgrade(plan)}
                    >
                      {plan.id === currentPlan.id ? "Current Plan" : "Upgrade"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Method */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <CardDescription>Manage your payment details.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-20 rounded-lg bg-gradient-to-r from-blue-600 to-blue-800 flex items-center justify-center">
                    <span className="text-white text-sm font-bold">VISA</span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">•••• •••• •••• 4242</p>
                    <p className="text-sm text-muted-foreground">Expires 12/27</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="bg-transparent">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Update
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoices */}
        <Card className="border-border bg-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Billing History</CardTitle>
                <CardDescription>View and download past invoices.</CardDescription>
              </div>
              <Button variant="outline" className="bg-transparent">
                <Download className="h-4 w-4 mr-2" />
                Export All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 text-sm font-medium text-muted-foreground">Invoice</th>
                      <th className="text-left py-3 text-sm font-medium text-muted-foreground">Date</th>
                      <th className="text-left py-3 text-sm font-medium text-muted-foreground">Amount</th>
                      <th className="text-left py-3 text-sm font-medium text-muted-foreground">Status</th>
                      <th className="text-right py-3 text-sm font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-b border-border">
                        <td className="py-3 font-medium text-foreground">{invoice.id}</td>
                        <td className="py-3 text-muted-foreground">{invoice.date}</td>
                        <td className="py-3 text-foreground">${invoice.amount.toFixed(2)}</td>
                        <td className="py-3">
                          <Badge
                            variant="outline"
                            className={
                              invoice.status === "paid"
                                ? "bg-green-500/10 text-green-500 border-green-500/20"
                                : "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                            }
                          >
                            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          <Button variant="ghost" size="sm">
                            <Download className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Cancel Subscription
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel? You'll lose access to premium features at the end of your billing period.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">You'll lose access to:</p>
            <ul className="space-y-2">
              {currentPlan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)} className="bg-transparent">
              Keep Subscription
            </Button>
            <Button variant="destructive" onClick={handleCancelSubscription}>
              Cancel Subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upgrade Dialog */}
      <Dialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade to {selectedPlan?.name}</DialogTitle>
            <DialogDescription>
              You'll be charged ${isYearly ? selectedPlan?.yearlyPrice : selectedPlan?.price}
              {isYearly ? "/year" : "/month"} starting today.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="p-4 rounded-lg bg-secondary/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current Plan</span>
                <span className="text-foreground">{currentPlan.name}</span>
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight className="h-5 w-5 text-primary" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">New Plan</span>
                <span className="font-semibold text-primary">{selectedPlan?.name}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              You'll be credited for the remaining time on your current plan.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeDialogOpen(false)} className="bg-transparent">
              Cancel
            </Button>
            <Button onClick={handleConfirmUpgrade}>Confirm Upgrade</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
