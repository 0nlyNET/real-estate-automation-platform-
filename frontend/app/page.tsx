import Link from "next/link"
import { ArrowRight, CheckCircle2, ClipboardCheck, MessagesSquare, Route } from "lucide-react"
import { MarketingHeader } from "@/components/ui/marketing-header"
import { Footer } from "@/components/ui/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const capabilities = [
  { icon: MessagesSquare, title: "Approved follow-up", text: "Human-reviewed SMS and email sequences with quiet hours, consent checks, STOP handling, and delivery states where supported." },
  { icon: Route, title: "Lead intake and routing", text: "Capture leads from configured sources, deduplicate them, assign team ownership, and keep conversation history together." },
  { icon: ClipboardCheck, title: "Supervised launch", text: "A platform operator records provider tests, controlled-lead evidence, billing status, and written approval before activation." },
]

export default function HomePage() {
  return <div className="min-h-screen bg-background"><MarketingHeader />
    <section className="border-b py-24"><div className="mx-auto max-w-5xl px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">Managed real-estate lead response</p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">A supervised system for lead intake, routing, and follow-up</h1>
      <p className="mx-auto mt-6 max-w-3xl text-lg text-muted-foreground">RealtyTechAI configures an inactive workspace around your approved messaging, providers, consent process, and team workflow. Automation starts only after readiness and launch review.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3"><Button asChild size="lg"><Link href="/apply">Apply for the paid pilot <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button asChild variant="outline" size="lg"><Link href="/features">Review current capabilities</Link></Button></div>
    </div></section>
    <section className="py-20"><div className="mx-auto max-w-6xl px-4"><div className="grid gap-5 md:grid-cols-3">{capabilities.map(({ icon: Icon, title, text }) => <Card key={title}><CardHeader><Icon className="h-6 w-6 text-primary" /><CardTitle>{title}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{text}</CardContent></Card>)}</div>
      <div className="mt-14 rounded-xl border p-8"><h2 className="text-2xl font-semibold">How a pilot launches</h2><div className="mt-6 grid gap-4 md:grid-cols-3">{["Apply and confirm commercial fit","Complete intake and provider tests","Approve templates, run UAT, and activate"].map((item, index) => <div className="flex gap-3" key={item}><CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" /><div><div className="font-medium">Step {index + 1}</div><div className="text-sm text-muted-foreground">{item}</div></div></div>)}</div></div>
    </div></section><Footer /></div>
}
