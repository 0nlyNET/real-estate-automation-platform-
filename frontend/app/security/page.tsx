import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Shield, Lock, Server, Eye, FileCheck, Users } from "lucide-react"

const securityFeatures = [
  {
    icon: Lock,
    title: "Transport Security",
    description: "Production deployments should terminate HTTPS at a trusted proxy or hosting platform.",
  },
  {
    icon: Server,
    title: "Tenant Isolation",
    description: "API access is scoped by tenant and protected with server-side authorization checks.",
  },
  {
    icon: Shield,
    title: "Webhook Verification",
    description: "Twilio webhook signatures are validated before inbound messages are processed.",
  },
  {
    icon: Eye,
    title: "Role Controls",
    description: "Owner, admin, transaction-coordinator, agent, and read-only roles limit sensitive actions.",
  },
  {
    icon: FileCheck,
    title: "Credential Handling",
    description: "Integration credentials are stored encrypted and are not exposed through application responses.",
  },
  {
    icon: Users,
    title: "Abuse Controls",
    description: "Authentication and public intake endpoints include request validation and rate limits.",
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
              The product includes practical safeguards for authentication, tenant isolation, integrations, and
              messaging. Your hosting and provider configuration remain part of the security boundary.
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
                Production operators should use managed PostgreSQL, HTTPS, restricted network access, backups, and
                monitoring appropriate to their risk profile. These controls are deployment responsibilities.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Data Protection</h3>
              <p className="mt-2">
                Tenant identifiers are enforced in service queries, integration secrets are encrypted before storage,
                and sensitive values are excluded from normal API responses and logs.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Authentication & Access</h3>
              <p className="mt-2">
                The application uses signed JWTs, verified email accounts, strong password requirements, and
                server-side role checks. MFA and SSO are not currently included.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Compliance</h3>
              <p className="mt-2">
                RealtyTechAI does not currently claim a third-party security certification. Customers are responsible
                for assessing their own legal, privacy, retention, consent, and messaging obligations.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Incident Response</h3>
              <p className="mt-2">
                Operators should configure logs, alerts, backups, key rotation, and an incident-response process before
                handling production data.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground">Vulnerability Disclosure</h3>
              <p className="mt-2">
                If you discover a security issue, use the contact page and avoid including live credentials or customer
                data in the initial report.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
