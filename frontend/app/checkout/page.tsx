import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function CheckoutPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4">
      <Card>
        <CardHeader><CardTitle>Secure subscription checkout</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>RealtyTechAI never collects card numbers in this application. Signed-in workspace administrators start checkout from Billing and complete payment on Stripe&apos;s hosted checkout page.</p>
          <div className="flex gap-2">
            <Button asChild><Link href="/app/billing/upgrade">Choose a plan</Link></Button>
            <Button asChild variant="outline"><Link href="/pricing">View plans</Link></Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
