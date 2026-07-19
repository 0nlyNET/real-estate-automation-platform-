import type { Metadata } from "next"
import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Field notes | RealtyTechAI", robots: { index: false, follow: false } }

export default function BlogPage() {
  return <div className="min-h-screen bg-background"><MarketingHeader /><main className="mx-auto max-w-3xl px-4 py-24"><h1 className="text-4xl font-bold">Field notes</h1><p className="mt-5 text-lg text-muted-foreground">No public articles are currently published. Product and compliance guidance is provided directly during supervised onboarding so unverified statistics and placeholder case studies are not presented as evidence.</p><Button asChild className="mt-8"><Link href="/apply">Apply for the paid pilot</Link></Button></main><Footer /></div>
}
