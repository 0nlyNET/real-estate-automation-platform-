"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, CreditCard, Loader2 } from "lucide-react";

type BillingInterval = "month" | "year";
type PlanKey = "pro" | "teams";

type CheckoutResponse = { url: string };

export default function BillingUpgradePage() {
  const [plan, setPlan] = useState<PlanKey>("pro");
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceLine = useMemo(() => {
    if (plan === "pro") return interval === "month" ? "$79/month" : "$790/year";
    return interval === "month" ? "$149/month" : "$1,490/year";
  }, [plan, interval]);

  const planCards = [
    {
      key: "pro" as const,
      name: "Pro",
      highlight: true,
      blurb: "Best for solo agents",
      features: ["Advanced automations", "Sequences", "Reporting", "Priority support"],
      monthly: "$79",
      yearly: "$790",
    },
    {
      key: "teams" as const,
      name: "Teams",
      highlight: false,
      blurb: "Best for teams and brokerages",
      features: ["Team seats", "Shared inbox", "Team reporting", "Admin controls"],
      monthly: "$149",
      yearly: "$1,490",
    },
  ];

  const startCheckout = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<CheckoutResponse>("/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          interval,
          // keep redirect behavior the same
          successUrl: `${window.location.origin}/app/billing?status=success`,
          cancelUrl: `${window.location.origin}/app/billing?status=cancel`,
        }),
      } as any);

      window.location.href = res.url;
    } catch (e: any) {
      setError(e?.message || "Failed to start checkout.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Upgrade</h1>
            <p className="text-muted-foreground">Pick a plan, then continue to Stripe Checkout.</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/app/billing">Back</Link>
          </Button>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Billing cycle</div>
              <div className="mt-2 flex items-center gap-3">
                <span className={interval === "month" ? "font-medium" : "text-muted-foreground"}>Monthly</span>
                <Switch
                  checked={interval === "year"}
                  onCheckedChange={(v) => setInterval(v ? "year" : "month")}
                />
                <span className={interval === "year" ? "font-medium" : "text-muted-foreground"}>Yearly</span>
                <Badge variant="secondary" className="ml-1">Save with annual</Badge>
              </div>
            </div>

            <div className="rounded-lg border bg-secondary/40 px-4 py-3">
              <div className="text-sm text-muted-foreground">Selected</div>
              <div className="mt-1 text-lg font-semibold">
                {plan === "pro" ? "Pro" : "Teams"} · {interval === "month" ? "Monthly" : "Yearly"}
              </div>
              <div className="text-sm text-muted-foreground">{priceLine}</div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {planCards.map((p) => {
            const selected = plan === p.key;
            const price = interval === "month" ? p.monthly : p.yearly;

            return (
              <Card
                key={p.key}
                className={[
                  selected ? "border-primary/50" : "",
                  p.highlight ? "bg-card" : "bg-card",
                ].join(" ")}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      {p.name}
                      {p.highlight ? <Badge>Most Popular</Badge> : null}
                    </CardTitle>
                    {selected ? <Badge variant="secondary">Selected</Badge> : null}
                  </div>
                  <div className="text-sm text-muted-foreground">{p.blurb}</div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold">{price}</span>
                    <span className="text-sm text-muted-foreground">{interval === "month" ? "/month" : "/year"}</span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <ul className="space-y-2 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    type="button"
                    className="w-full"
                    variant={selected ? "default" : "outline"}
                    onClick={() => setPlan(p.key)}
                    disabled={loading}
                  >
                    {selected ? "Selected" : `Choose ${p.name}`}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardContent className="flex flex-col gap-3 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold">Continue to Checkout</div>
              <div className="text-sm text-muted-foreground">
                You will be redirected to Stripe. After payment, you will return to Billing.
              </div>
            </div>
            <Button onClick={startCheckout} disabled={loading} className="min-w-[220px]">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting Checkout
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Continue to Checkout
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
