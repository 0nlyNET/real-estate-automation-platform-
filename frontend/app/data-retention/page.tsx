import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

export default function DataRetentionPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-24 text-muted-foreground">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Data Retention &amp; Deletion Policy</h1>
          <p className="mt-4">Effective August 11, 2026</p>
        </div>
        <section>
          <h2 className="text-xl font-semibold text-foreground">During service</h2>
          <p className="mt-3">Business configuration, leads, consent evidence, conversations, appointments, audit events, support records, and billing references are retained while needed to provide, secure, support, and account for the managed service.</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Cancellation and offboarding</h2>
          <p className="mt-3">Cancellation stops protected automation according to the subscription terms. It does not immediately erase records. An owner-controlled export can include leads, contact information, conversation history, appointments, lead status, and relevant reports before deletion.</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Retention schedule</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Operational client data: retained through active service and the documented offboarding window.</li>
            <li>Consent, opt-out, audit, security, billing, dispute, and legal records: retained as reasonably required for compliance, security, accounting, and claims.</li>
            <li>Backups: expire according to the protected backup-retention schedule and are not used to restore an offboarded client into active service.</li>
          </ul>
          <p className="mt-3">Exact production periods must be approved for the applicable contracts, laws, and provider obligations before public launch.</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Requests and deletion</h2>
          <p className="mt-3">Verified access, correction, export, or deletion requests can be submitted through authenticated support. Requests are evaluated for identity, authority, billing, security, backup expiry, and applicable retention obligations. See the <Link className="text-primary hover:underline" href="/privacy">Privacy Policy</Link> for additional information.</p>
        </section>
        <p className="rounded-lg border p-4 text-sm">This policy is an operational draft and should receive qualified legal review for the actual business model before public use.</p>
      </main>
      <Footer />
    </div>
  )
}
