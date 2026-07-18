"use client"

import { useState } from "react"
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
          : "Your ticket was saved, but operator email notification is not configured yet.",
      })
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Could not send." })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
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
