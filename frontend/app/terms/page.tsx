import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Terms of Service</h1>
          <p className="mt-4 text-muted-foreground">Last updated: January 1, 2026</p>

          <div className="mt-12 space-y-8 text-muted-foreground">
            <section>
              <h2 className="text-xl font-semibold text-foreground">1. Acceptance of Terms</h2>
              <p className="mt-4">
                By accessing or using RealtyTechAI ("Service"), you agree to be bound by these Terms of Service. If you
                do not agree to these terms, do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">2. Description of Service</h2>
              <p className="mt-4">
                RealtyTechAI provides a lead management and automation platform for real estate professionals. Features
                include lead capture, automated messaging, inbox management, and reporting tools.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">3. User Accounts</h2>
              <p className="mt-4">You are responsible for:</p>
              <ul className="mt-4 list-disc space-y-2 pl-6">
                <li>Maintaining the confidentiality of your account credentials</li>
                <li>All activities that occur under your account</li>
                <li>Notifying us immediately of any unauthorized use</li>
                <li>Ensuring your account information is accurate and up-to-date</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">4. Acceptable Use</h2>
              <p className="mt-4">You agree not to:</p>
              <ul className="mt-4 list-disc space-y-2 pl-6">
                <li>Violate any applicable laws or regulations</li>
                <li>Send unsolicited messages or spam</li>
                <li>Impersonate any person or entity</li>
                <li>Interfere with or disrupt the Service</li>
                <li>Attempt to gain unauthorized access to any systems</li>
                <li>Use the Service for any illegal or harmful purpose</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">5. Messaging Compliance</h2>
              <p className="mt-4">
                You are solely responsible for ensuring your use of messaging features complies with applicable laws
                including TCPA, CAN-SPAM, and state-specific regulations. You must obtain proper consent before sending
                automated messages.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">6. Payment Terms</h2>
              <p className="mt-4">
                Paid subscriptions are billed in advance on a monthly or annual basis. All fees are non-refundable
                except as required by law. We may change pricing with 30 days notice.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">7. Intellectual Property</h2>
              <p className="mt-4">
                The Service and its original content, features, and functionality are owned by RealtyTechAI LLC and are
                protected by intellectual property laws. You retain ownership of your data.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">8. Limitation of Liability</h2>
              <p className="mt-4">
                RealtyTechAI LLC shall not be liable for any indirect, incidental, special, consequential, or punitive
                damages resulting from your use of the Service. Our total liability shall not exceed the amount you paid
                us in the past 12 months.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">9. Termination</h2>
              <p className="mt-4">
                We may terminate or suspend your account at any time for violation of these terms. You may cancel your
                account at any time. Upon termination, your right to use the Service ceases immediately.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">10. Changes to Terms</h2>
              <p className="mt-4">
                We reserve the right to modify these terms at any time. We will notify you of material changes via email
                or through the Service. Continued use after changes constitutes acceptance.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">11. Governing Law</h2>
              <p className="mt-4">
                These terms shall be governed by the laws of the State of Texas, without regard to conflict of law
                provisions.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">12. Contact</h2>
              <p className="mt-4">For questions about these Terms, contact us at legal@realtytechai.com</p>
            </section>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
