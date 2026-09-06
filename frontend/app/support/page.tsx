"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { supportReturnPath } from "@/lib/support-navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { apiFetch } from "@/lib/api"

export default function SupportPage() {
  const { toast } = useToast()
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [backHref, setBackHref] = useState("/")

  useEffect(() => {
    let active = true
    apiFetch<{ platformRole: string | null; serviceAccess?: { allowed: boolean; billingEligible: boolean } }>("/me")
      .then((me) => {
        let previous: string | null = new URLSearchParams(window.location.search).get("from")
        try { previous ||= sessionStorage.getItem("supportReturnPath") } catch {}
        const target = !me.platformRole && me.serviceAccess?.allowed === false
          ? "/app/billing" : supportReturnPath(previous, Boolean(me.platformRole), true)
        if (active) setBackHref(target)
      }).catch(() => { if (active) setBackHref("/") })
    return () => { active = false }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await apiFetch<{ ok: boolean; message?: string; notificationSent?: boolean }>("/support/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      })
      if (!res?.ok) throw new Error(res?.message || "Failed")
      setSubject("")
      setMessage("")
      toast({
        title: "Support ticket created",
        description: res.notificationSent
          ? "The support team was notified."
          : "Your ticket was saved for the support team to review.",
      })
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Could not send." })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Button asChild variant="ghost" className="mb-4"><Link href={backHref}><ArrowLeft className="h-4 w-4" /> Back</Link></Button>
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Contact support</h1>
            <p className="text-sm text-muted-foreground">Send us a message and we will follow up.</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <textarea
                className="w-full min-h-[140px] rounded-md border border-border bg-background p-3 text-sm"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
