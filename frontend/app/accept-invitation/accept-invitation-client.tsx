"use client"

import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

export default function AcceptInvitationClient() {
  const params = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const token = useMemo(() => params.get("token") || "", [params])
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!token) return toast({ title: "Missing invitation", description: "Use the link from your email." })
    if (password !== confirmation) return toast({ title: "Passwords do not match" })
    setLoading(true)
    try {
      const response = await fetch("/api/backend/auth/accept-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || "Invitation could not be accepted")
      toast({ title: "Account ready", description: "Your password was set securely." })
      router.replace("/app/onboarding")
    } catch (error: unknown) {
      toast({ title: "Invitation error", description: error instanceof Error ? error.message : "Try requesting a new invitation." })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl font-semibold">Set up your account</h1>
          <p className="text-sm text-muted-foreground">Choose your own password. This invitation can be used once.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} />
              <p className="text-xs text-muted-foreground">Minimum 12 characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmation">Confirm password</Label>
              <Input id="confirmation" type="password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </div>
            <Button className="w-full" disabled={loading || !token}>{loading ? "Setting up…" : "Set password and continue"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
