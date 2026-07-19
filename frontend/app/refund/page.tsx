import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-24 text-muted-foreground">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Refund Policy</h1>
        <p>Effective July 19, 2026</p>
        <p>
          Package fees and billing intervals are confirmed before payment. If you believe a charge is duplicated,
          unauthorized, or inconsistent with the confirmed order, submit a billing request with the workspace name,
          invoice date, and a description of the issue. Requests are reviewed against the order, service history,
          payment-processor records, and applicable law.
        </p>
        <p>
          Canceling a subscription stops renewal according to the applicable billing terms; it does not automatically
          reverse charges already incurred. Service termination and verified data deletion are separate processes.
        </p>
        <p>
          Clients can use authenticated support. Other billing inquiries can be submitted through the{
          " "}<Link className="text-primary hover:underline" href="/contact">public contact page</Link>.
        </p>
      </main>
      <Footer />
    </div>
  )
}
