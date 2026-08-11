import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <main className="py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Terms of Service</h1>
          <p className="mt-4 text-muted-foreground">Effective August 11, 2026</p>

          <div className="mt-12 space-y-8 text-muted-foreground">
            <section>
              <h2 className="text-xl font-semibold text-foreground">Service relationship</h2>
              <p className="mt-4">
                RealtyTechAI is a managed lead-intake, routing, approved follow-up, shared-inbox, and reporting service
                for real-estate teams. The agreed order, onboarding record, approved message content, enabled providers,
                and service scope form part of the client&apos;s service configuration. Features that have not passed the
                documented launch checks remain inactive.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Accounts and client responsibilities</h2>
              <ul className="mt-4 list-disc space-y-2 pl-6">
                <li>Keep credentials confidential and promptly report suspected unauthorized access.</li>
                <li>Provide accurate lead-source, consent, sender-identity, booking, and team-routing information.</li>
                <li>Review and approve message templates before activation.</li>
                <li>Use the service lawfully and do not upload purchased lists, send spam, or bypass opt-outs.</li>
                <li>Maintain any licenses, permissions, and notices required for the client&apos;s business and contacts.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Messaging and consent</h2>
              <p className="mt-4">
                The client must supply appropriate channel-specific consent evidence before automated contact. The
                service blocks automated messages when required evidence is missing and honors supported SMS STOP and
                email unsubscribe requests. These controls assist operations but do not replace the client&apos;s legal
                obligations or professional advice.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Fees, billing, and refunds</h2>
              <p className="mt-4">
                The managed-service scope, monthly billing start date, and fees are confirmed in the applicable order
                or checkout before payment. Subscription charges renew monthly until canceled. Billing-error and refund
                requests are reviewed under the <Link className="text-primary hover:underline" href="/refund">refund policy</Link>
                and any applicable law; these terms do not make a conflicting blanket promise.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Cancellation, suspension, and deletion</h2>
              <p className="mt-4">
                A subscription cancellation stops future renewal according to the billing terms. Service suspension or
                termination disables access and automated activity but may not immediately delete records needed for
                security, billing, support, or legal purposes. A data-deletion request is a separate verified workflow
                and may be subject to retention obligations.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Availability and third parties</h2>
              <p className="mt-4">
                The service depends on hosting, communications, payment, and lead-source providers. We do not guarantee
                uninterrupted operation, message delivery, lead volume, appointments, revenue, or transaction outcomes.
                Provider terms and outages may affect an enabled workflow.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Ownership and acceptable use</h2>
              <p className="mt-4">
                Clients retain their rights in submitted business and lead data. The RealtyTechAI service, interface,
                and original software remain the operator&apos;s materials. Users may not misuse the service, probe or
                disrupt security, impersonate others, violate law, or attempt unauthorized access. The separate{" "}
                <Link className="text-primary hover:underline" href="/acceptable-use">Acceptable Use Policy</Link>{" "}
                applies to all service activity.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Disclaimers and responsibility</h2>
              <p className="mt-4">
                The service is provided subject to the written service agreement and applicable law. Real-estate,
                communications, privacy, and advertising obligations vary by jurisdiction. Each party remains
                responsible for its own acts, content, approvals, and legal obligations.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Contact and changes</h2>
              <p className="mt-4">
                Questions can be submitted through authenticated support or the <Link className="text-primary hover:underline" href="/contact">public contact page</Link>.
                Material changes will be identified by a revised effective date and communicated through an appropriate channel.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
