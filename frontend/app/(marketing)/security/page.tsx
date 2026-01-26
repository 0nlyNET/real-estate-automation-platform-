import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Shield, Lock, Server, Eye, FileCheck, Users } from "lucide-react"

const securityFeatures = [
  {
    icon: Lock,
    title: "256-bit Encryption",
    description: "All data is encrypted in transit and at rest using industry-standard AES-256 encryption.",
  },
  {
    icon: Server,
    title: "SOC 2 Type II Compliant",
    description: "Our infrastructure and processes are audited annually to meet SOC 2 security standards.",
  },
  {
    icon: Shield,
    title: "DDoS Protection",
    description: "Enterprise-grade protection against distributed denial-of-service attacks.",
  },
  {
    icon: Eye,
    title: "24/7 Monitoring",
    description: "Continuous security monitoring and threat detection across all systems.",
  },
  {
    icon: FileCheck,
    title: "Regular Audits",
    description: "Third-party security assessments and penetration testing performed quarterly.",
  },
  {
    icon: Users,
    title: "Access Controls",
    description: "Role-based access control and multi-factor authentication for all accounts.",
  },
]

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="border-b border-border py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Security at <span className="text-primary">RealtyTechAI</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Your data security is our top priority. We employ enterprise-grade security measures to protect your
              information.
            </p>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {securityFeatures.map((feature, index) => (
              <Card key={index} className="border-border bg-card">
                <CardContent className="p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">{feature.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-card/50 py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-foreground">Our Security Practices</h2>

          <div className="mt-8 space-y-8 text-muted-foreground">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Infrastructure Security</h3>
              <p className="mt-2">
                Our platform runs on secure, SOC 2 compliant cloud infrastructure with automatic failover, redundant
                backups, and geographically distributed data centers.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Data Protection</h3>
              <p className="mt-2">
                All customer data is encrypted using AES-256 encryption. We implement strict access controls and audit
                logging for all data access.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Authentication & Access</h3>
              <p className="mt-2">
                We support multi-factor authentication, SSO integration, and enforce strong password policies. Session
                management includes automatic timeouts and secure token handling.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Compliance</h3>
              <p className="mt-2">
                We maintain compliance with industry standards including SOC 2 Type II, GDPR, CCPA, and follow OWASP
                security guidelines.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Incident Response</h3>
              <p className="mt-2">
                We have a dedicated security team and documented incident response procedures. In the event of a
                security incident, affected customers are notified within 72 hours.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Vulnerability Disclosure</h3>
              <p className="mt-2">
                If you discover a security vulnerability, please report it to security@realtytechai.com. We take all
                reports seriously and will respond within 48 hours.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
