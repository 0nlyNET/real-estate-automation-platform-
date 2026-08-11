import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"

export default function AcceptableUsePage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-24 text-muted-foreground">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Acceptable Use Policy</h1>
          <p className="mt-4">Effective August 11, 2026</p>
        </div>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Authorized lead communications only</h2>
          <p className="mt-3">Clients may use RealtyTechAI only for contacts they collected lawfully and are authorized to contact through the intended channel. Purchased, scraped, rented, harvested, or cold lists are prohibited.</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Prohibited activity</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Spam, deceptive sender identities, impersonation, fraud, harassment, or unlawful discrimination.</li>
            <li>Bypassing consent, STOP, unsubscribe, quiet-hour, human-takeover, rate, or suspension controls.</li>
            <li>Malware, credential theft, security probing, unauthorized access, or interference with another tenant.</li>
            <li>Content that violates provider rules, applicable law, professional obligations, or fair-housing requirements.</li>
            <li>Automation loops, artificial traffic, or attempts to evade usage and cost limits.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Monitoring and enforcement</h2>
          <p className="mt-3">RealtyTechAI may warn, rate-limit, pause, or suspend activity when delivery failures, bounces, opt-outs, spam complaints, unusual volume, prohibited content, or other risk signals threaten recipients or shared provider accounts. Serious incidents may require evidence and corrective action before restoration.</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">Reporting concerns</h2>
          <p className="mt-3">Report suspected abuse through authenticated support or the <Link className="text-primary hover:underline" href="/contact">contact page</Link>.</p>
        </section>
        <p className="rounded-lg border p-4 text-sm">This operational policy should be reviewed with qualified counsel for the actual service, customers, jurisdictions, and provider requirements.</p>
      </main>
      <Footer />
    </div>
  )
}
