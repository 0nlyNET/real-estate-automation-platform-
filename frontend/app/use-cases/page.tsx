import Link from "next/link"
import { Building2, CheckCircle2, User, Users } from "lucide-react"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const workflows = [
  { icon: User, title: "Solo agent", text: "Keep eligible lead intake, approved outreach, replies, and stage updates in one workspace.", items: ["Configured lead intake", "Approved SMS or email sequences", "Reply and opt-out stopping", "Basic response and stage reporting"] },
  { icon: Users, title: "Team", text: "Apply documented assignment rules and share approved messaging while preserving user scope.", items: ["Round-robin or fixed assignment", "Team and user roles", "Shared templates and history", "Agent-scoped activity reporting"] },
  { icon: Building2, title: "Brokerage pilot", text: "Launch selected services with explicit operator evidence and pause controls.", items: ["Tenant-scoped workspaces", "Consent and quiet-hour controls", "Provider connection tests", "Supervised readiness and activation"] },
]

export default function UseCasesPage() {
  return <div className="min-h-screen bg-background"><MarketingHeader /><main><section className="border-b py-20"><div className="mx-auto max-w-4xl px-4 text-center"><h1 className="text-4xl font-bold">Supported workflows</h1><p className="mt-5 text-lg text-muted-foreground">Examples of how current product capabilities can be configured. These are not performance claims, guarantees, or customer case studies.</p></div></section><section className="py-20"><div className="mx-auto grid max-w-6xl gap-5 px-4 lg:grid-cols-3">{workflows.map(({ icon: Icon, title, text, items }) => <Card key={title}><CardHeader><Icon className="h-6 w-6 text-primary" /><CardTitle>{title}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{text}</p><ul className="mt-5 space-y-3">{items.map((item) => <li className="flex gap-2 text-sm" key={item}><CheckCircle2 className="h-4 w-4 text-primary" />{item}</li>)}</ul></CardContent></Card>)}</div><div className="mt-10 text-center"><Button asChild><Link href="/apply">Discuss a paid pilot</Link></Button></div></section></main><Footer /></div>
}
