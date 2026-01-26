"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"

export default function VerifyEmailClient() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const token = useMemo(() => searchParams.get("token") || "", [searchParams])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

  useEffect(() => {
    async function run() {
      if (!token) {
        setMessage("Missing verification token.")
        return
      }

      setLoading(true)
      setMessage(null)

      try {
        const res = await fetch(`${apiUrl}/auth/verify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })

        if (!res.ok) {
          let err = "Verification failed."
          try {
            const j = await res.json()
            err = j?.message || err
          } catch {}
          throw new Error(err)
        }

        setMessage("Email verified. Redirecting to login...")
        setTimeout(() => router.push("/login"), 900)
      } catch (e: any) {
        setMessage(e?.message || "Verification failed.")
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [token, router, apiUrl])

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-4">
      <div className="w-full rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">Verify Email</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading ? "Verifying..." : "We are confirming your email address."}
        </p>

        {message && (
          <div className="mt-4 rounded-md border bg-muted/50 p-3 text-sm">
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
