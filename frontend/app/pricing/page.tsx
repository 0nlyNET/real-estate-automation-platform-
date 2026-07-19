import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { publicPlanCatalog } from "@/lib/public-plan-catalog"

export default function PricingPage() {
  return <main className="mx-auto max-w-5xl px-4 py-16"><h1 className="text-4xl font-bold">Plans for managed onboarding</h1><p className="mt-3 text-muted-foreground">Confirmed prices, provider usage, message allowances, and support scope are documented before checkout. Undefined Stripe prices cannot start checkout.</p><div className="mt-8 grid gap-4 md:grid-cols-2">{publicPlanCatalog.map((plan) => <Card key={plan.id}><CardHeader><CardTitle>{plan.name}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="font-medium">{plan.pricing}</p><p className="text-sm text-muted-foreground">{plan.description}</p><Button asChild><Link href="/apply">Request pilot pricing</Link></Button></CardContent></Card>)}</div></main>
}
