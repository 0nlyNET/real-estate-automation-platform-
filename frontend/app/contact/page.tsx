import Link from "next/link"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function ContactPage() {
  return <div className="min-h-screen bg-background"><MarketingHeader /><main className="mx-auto max-w-4xl px-4 py-24"><h1 className="text-4xl font-bold">Contact and pilot inquiries</h1><p className="mt-4 max-w-2xl text-muted-foreground">Use the application form for demos, service questions, partnership inquiries, and paid-pilot qualification. Existing clients can sign in and open a tracked support request.</p><div className="mt-10 grid gap-5 md:grid-cols-2"><Card><CardHeader><CardTitle>Prospective clients</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Tell us about your business, lead sources, expected volume, and requested service.</p><Button asChild><Link href="/apply">Open application</Link></Button></CardContent></Card><Card><CardHeader><CardTitle>Existing clients</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Sign in to save a support ticket with severity and a durable reference.</p><Button asChild variant="outline"><Link href="/support">Open client support</Link></Button></CardContent></Card></div></main><Footer /></div>
}
