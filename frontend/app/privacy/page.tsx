import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <main className="py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
          <p className="mt-4 text-muted-foreground">Effective July 19, 2026</p>

          <div className="mt-12 space-y-8 text-muted-foreground">
            <section>
              <h2 className="text-xl font-semibold text-foreground">Scope</h2>
              <p className="mt-4">
                This policy describes how the operator of the RealtyTechAI managed lead-response service collects,
                uses, and shares information through the public website, client portal, and supported workflows.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Information we process</h2>
              <ul className="mt-4 list-disc space-y-2 pl-6">
                <li>Account and business information supplied by clients and their team members.</li>
                <li>Lead contact details, source, consent evidence, assignments, stages, and communication history.</li>
                <li>Support, application, onboarding, cancellation, and data-deletion requests.</li>
                <li>Technical and security records needed to authenticate users, operate integrations, and investigate failures.</li>
                <li>Subscription and invoice references from the payment processor; card details are handled by the processor.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">How information is used</h2>
              <p className="mt-4">
                We use information to provide and supervise the service, route and respond to leads according to the
                client&apos;s approved configuration, maintain accounts, process billing, provide support, prevent abuse,
                troubleshoot integrations, and meet legal obligations.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Service providers and disclosures</h2>
              <p className="mt-4">
                Information may be processed by hosting, database, email, SMS, lead-source, and payment providers that
                support an enabled workflow. We may also disclose information when required by law, to protect users or
                the service, or as part of a business transaction. We do not represent client lead data as our own.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Security and retention</h2>
              <p className="mt-4">
                We use access controls, encrypted provider credentials, HTTPS in production, and operational monitoring
                to reduce risk. No system can guarantee absolute security. Records are retained for service, security,
                billing, and legal needs and are deleted or de-identified when no longer required.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Choices and requests</h2>
              <p className="mt-4">
                Depending on your location and relationship to a client, you may ask to access, correct, export, or
                delete personal information, or object to certain processing. Marketing or automated email can be
                stopped through the unsubscribe link in the message; SMS recipients can reply STOP. Account cancellation
                does not by itself constitute a verified data-deletion request.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Cookies</h2>
              <p className="mt-4">
                The client portal uses an essential HttpOnly session cookie for authentication. Interface preferences
                may be stored in the browser. Public-site analytics are not currently enabled.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Contact</h2>
              <p className="mt-4">
                Submit privacy questions or data requests through the authenticated support page. If you do not have an
                account, use the <Link className="text-primary hover:underline" href="/contact">public contact page</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">Changes</h2>
              <p className="mt-4">
                We may update this policy as the service or legal requirements change. A revised effective date will be
                shown here, and material changes will be communicated through an appropriate channel.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
