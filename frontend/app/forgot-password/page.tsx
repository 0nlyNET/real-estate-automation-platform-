"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

export default function ForgotPasswordPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [resetLink, setResetLink] = useState("")

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setResetLink("")

    try {
      const res = await fetch(`${apiUrl}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data?.message || "Something went wrong.")
      }

      if (data?.resetLink) {
        setResetLink(String(data.resetLink))
        toast({
          title: "Reset link created",
          description: "Use the link below to finish resetting the password.",
        })
        return
      }

      toast({
        title: "Check your email",
        description: "If that email exists, a reset link was sent.",
      })
      router.push("/login")
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Something went wrong. Try again." })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Forgot password</h1>
            <p className="text-sm text-muted-foreground">We will create a reset link for your account.</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create reset link"}
            </Button>

            {resetLink && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm break-all">
                <div className="mb-2 font-medium">Reset link</div>
                <a className="underline" href={resetLink}>
                  {resetLink}
                </a>
              </div>
            )}

            <div className="text-sm text-muted-foreground">
              <Link href="/login" className="underline">Back to login</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
