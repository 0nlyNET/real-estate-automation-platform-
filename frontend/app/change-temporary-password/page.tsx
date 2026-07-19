"use client"

import { FormEvent, Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function ChangeTemporaryPasswordContent() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState(params.get("email") || "")
  const [temporaryPassword, setTemporaryPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    if (newPassword !== confirm) return setError("New passwords do not match")
    setLoading(true)
    try {
      const response = await fetch("/api/backend/auth/change-temporary-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, temporaryPassword, newPassword }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(Array.isArray(result.message) ? result.message.join(", ") : result.message || "Password change failed")
      }
      router.replace("/login?passwordChanged=1")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password change failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-semibold">Replace temporary password</h1>
          <p className="text-sm text-muted-foreground">Set a private password before opening your workspace.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
            <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="temporary">Temporary password</Label><Input id="temporary" type="password" value={temporaryPassword} onChange={(e) => setTemporaryPassword(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="new">New password</Label><Input id="new" type="password" minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="confirm">Confirm new password</Label><Input id="confirm" type="password" minLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
            <Button className="w-full" disabled={loading}>{loading ? "Changing password…" : "Change password"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

export default function ChangeTemporaryPasswordPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center">Loading…</main>}><ChangeTemporaryPasswordContent /></Suspense>
}
