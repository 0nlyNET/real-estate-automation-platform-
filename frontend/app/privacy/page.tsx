import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
          <p className="mt-4 text-muted-foreground">Last updated: January 1, 2026</p>

          <div className="mt-12 space-y-8 text-muted-foreground">
            <section>
              <h2 className="text-xl font-semibold text-foreground">1. Introduction</h2>
              <p className="mt-4">
                RealtyTechAI LLC ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy
                explains how we collect, use, disclose, and safeguard your information when you use our platform.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">2. Information We Collect</h2>
              <p className="mt-4">We collect information you provide directly to us, including:</p>
              <ul className="mt-4 list-disc space-y-2 pl-6">
                <li>Account information (name, email, password)</li>
                <li>Profile information (company name, phone number)</li>
                <li>Lead data you import or collect through our platform</li>
                <li>Communication content (messages, templates)</li>
                <li>Usage data and analytics</li>
                <li>Payment information (processed securely by Stripe)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">3. How We Use Your Information</h2>
              <p className="mt-4">We use the information we collect to:</p>
              <ul className="mt-4 list-disc space-y-2 pl-6">
                <li>Provide, maintain, and improve our services</li>
                <li>Process transactions and send related information</li>
                <li>Send technical notices, updates, and support messages</li>
                <li>Respond to your comments and questions</li>
                <li>Analyze usage patterns to improve user experience</li>
                <li>Detect, prevent, and address technical issues</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">4. Information Sharing</h2>
              <p className="mt-4">
                We do not sell, trade, or rent your personal information to third parties. We may share information
                with:
              </p>
              <ul className="mt-4 list-disc space-y-2 pl-6">
                <li>Service providers who assist in our operations</li>
                <li>Professional advisors (lawyers, accountants)</li>
                <li>Law enforcement when required by law</li>
                <li>Business partners with your consent</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">5. Data Security</h2>
              <p className="mt-4">
                We implement industry-standard security measures including 256-bit encryption, secure data centers, and
                regular security audits. However, no method of transmission over the Internet is 100% secure.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">6. Data Retention</h2>
              <p className="mt-4">
                We retain your information for as long as your account is active or as needed to provide services. You
                may request deletion of your data at any time.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">7. Your Rights</h2>
              <p className="mt-4">You have the right to:</p>
              <ul className="mt-4 list-disc space-y-2 pl-6">
                <li>Access your personal information</li>
                <li>Correct inaccurate data</li>
                <li>Request deletion of your data</li>
                <li>Object to processing of your data</li>
                <li>Export your data in a portable format</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">8. Cookies</h2>
              <p className="mt-4">
                We use cookies and similar technologies to enhance your experience. You can control cookies through your
                browser settings.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">9. Contact Us</h2>
              <p className="mt-4">
                If you have questions about this Privacy Policy, please contact us at privacy@realtytechai.com or by
                mail at:
              </p>
              <p className="mt-4">
                RealtyTechAI LLC
                <br />
                123 Tech Lane, Suite 400
                <br />
                Austin, TX 78701
              </p>
            </section>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
