"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

export default function ResetPasswordClient() {
  const router = useRouter()
  const params = useSearchParams()
  const { toast } = useToast()

  const token = useMemo(() => params.get("token") || "", [params])

  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) {
      toast({ title: "Missing token", description: "Use the link from your email." })
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.message || "Reset failed")
      }
      toast({ title: "Password updated", description: "You can log in now." })
      router.push("/login")
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Something went wrong." })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Reset password</h1>
            <p className="text-sm text-muted-foreground">Set a new password for your account.</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                required
              />
              <p className="text-xs text-muted-foreground">Minimum 12 characters.</p>
            </div>

            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? "Updating..." : "Update password"}
            </Button>

            <div className="text-sm text-muted-foreground">
              <Link href="/login" className="underline">
                Back to login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
