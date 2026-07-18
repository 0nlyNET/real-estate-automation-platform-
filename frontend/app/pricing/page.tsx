import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const plans = [
  { name: "Pro", text: "Lead capture, inbox, messaging integrations, and linear follow-up sequences." },
  { name: "Teams", text: "Adds team users, assignments, presence-aware routing, and agent reporting." },
]

export default function PricingPage() {
  return <main className="mx-auto max-w-5xl px-4 py-16"><h1 className="text-4xl font-bold">Plans for managed onboarding</h1><p className="mt-3 text-muted-foreground">Pricing and message allowances are confirmed during onboarding so provider usage and support scope are clear.</p><div className="mt-8 grid gap-4 md:grid-cols-2">{plans.map((plan) => <Card key={plan.name}><CardHeader><CardTitle>{plan.name}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{plan.text}</p><Button asChild><Link href="/contact">Request onboarding pricing</Link></Button></CardContent></Card>)}</div></main>
}
