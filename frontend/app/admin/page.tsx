import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { CookieBanner } from "@/components/ui/cookie-banner"
import { Card, CardContent } from "@/components/ui/card"

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <section className="py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Admin</h1>
          <p className="mt-2 text-muted-foreground">Only admins can access this page.</p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <Card className="border-border">
              <CardContent className="p-6">
                <div className="text-sm font-semibold text-foreground">Clients</div>
                <div className="mt-1 text-sm text-muted-foreground">Manage client access and installs.</div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardContent className="p-6">
                <div className="text-sm font-semibold text-foreground">System</div>
                <div className="mt-1 text-sm text-muted-foreground">Internal settings and monitoring.</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
      <Footer />
      <CookieBanner />
    </div>
  )
}
