import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { publicPlanCatalog } from "@/lib/public-plan-catalog"

export default function PricingPage() {
  return <main className="mx-auto max-w-3xl px-4 py-16"><h1 className="text-4xl font-bold">One managed RealtyTechAI service</h1><p className="mt-3 text-muted-foreground">No confusing software tiers. We confirm the setup fee, monthly service price, provider usage, and exact delivery scope before onboarding.</p><div className="mt-8">{publicPlanCatalog.map((plan) => <Card key={plan.id}><CardHeader><CardTitle>{plan.name}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="font-medium">{plan.pricing}</p><p className="text-sm text-muted-foreground">{plan.description}</p><Button asChild><Link href="/apply">Apply for RealtyTechAI</Link></Button></CardContent></Card>)}</div></main>
}
