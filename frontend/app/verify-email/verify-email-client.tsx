"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { apiFetch } from "@/lib/api"

export default function VerifyEmailClient() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const token = useMemo(() => searchParams.get("token") || "", [searchParams])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let redirectTimer: ReturnType<typeof setTimeout> | undefined

    async function run() {
      if (!token) {
        setMessage("Missing verification token.")
        return
      }

      setLoading(true)
      setMessage(null)

      try {
        await apiFetch("/auth/verify-email", {
          method: "POST",
          body: { token },
        })
        if (cancelled) return
        setMessage("Email verified. Redirecting to login...")
        redirectTimer = setTimeout(() => router.push("/login"), 900)
      } catch (error) {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : "Verification failed.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      if (redirectTimer) clearTimeout(redirectTimer)
    }
  }, [token, router])

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
