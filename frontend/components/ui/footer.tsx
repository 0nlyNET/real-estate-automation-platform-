import Link from "next/link"
import { Logo } from "@/components/logo"

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="space-y-4">
            <Logo size="md" />
            <p className="text-sm text-muted-foreground">
              We install lead follow-up systems for real estate teams.
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground">Explore</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/services" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Services
                </Link>
              </li>
              <li>
                <Link
                  href="/case-studies"
                  className="text-sm text-muted-foreground transition-colors hover:text-primary"
                >
                  Case Studies
                </Link>
              </li>
              <li>
                <Link href="/book" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Book a call
                </Link>
              </li>
              <li>
                <Link href="/apply" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Apply
                </Link>
              </li>
              <li>
                <Link href="/login" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Client login
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground">Company</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/about" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  About
                </Link>
              </li>
              <li>
                <Link href="/blog" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground">Legal</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/privacy" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/security" className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  Security
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <p className="text-center text-sm text-muted-foreground">© RealtyTechAI LLC</p>
        </div>
      </div>
    </footer>
  )
}
