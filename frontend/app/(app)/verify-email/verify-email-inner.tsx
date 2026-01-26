"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

export default function VerifyEmailInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const token = useMemo(() => searchParams.get("token") || "", [searchParams])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)
      setOk(false)

      if (!token) {
        setLoading(false)
        setError("Missing verification token. Please use the link from your email.")
        return
      }

      try {
        const res = await fetch(`${API_URL}/auth/verify-email?token=${encodeURIComponent(token)}`, {
          method: "GET",
        })

        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          if (cancelled) return
          setError(data?.message || "Verification failed. Try again.")
          setLoading(false)
          return
        }

        if (cancelled) return
        setOk(true)
        setLoading(false)

        setTimeout(() => router.push("/login"), 1200)
      } catch {
        if (cancelled) return
        setError("Network error. Try again.")
        setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [token, router])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Email verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <div className="text-sm text-muted-foreground">Verifying...</div>}

          {!loading && ok && (
            <div className="text-sm text-green-600">
              Verified. Sending you to login...
            </div>
          )}

          {!loading && error && (
            <div className="text-sm text-red-600">{error}</div>
          )}

          <div className="flex gap-2">
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Go to login</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
