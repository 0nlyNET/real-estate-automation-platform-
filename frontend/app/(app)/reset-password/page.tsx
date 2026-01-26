'use client'

import { Suspense, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"

function ResetPasswordInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const token = useMemo(() => searchParams.get("token") || "", [searchParams])

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!token) return setError("Missing reset token. Open the link from your email again.")
    if (!password || password.length < 8) return setError("Password must be at least 8 characters.")
    if (password !== confirm) return setError("Passwords do not match.")

    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `Reset failed (${res.status})`)
      }

      setOk(true)
      setTimeout(() => router.push("/login"), 800)
    } catch (err: any) {
      setError(err?.message || "Reset failed.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border p-6">
        <h1 className="text-xl font-semibold">Reset password</h1>
        <p className="mt-2 text-sm opacity-80">
          Set a new password for your account.
        </p>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div className="space-y-1">
            <label className="text-sm">New password</label>
            <input
              className="w-full rounded-md border px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm">Confirm password</label>
            <input
              className="w-full rounded-md border px-3 py-2"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
            />
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {ok ? <div className="text-sm text-green-600">Password updated. Redirecting…</div> : null}

          <button
            className="w-full rounded-md border px-3 py-2 font-medium"
            disabled={loading}
            type="submit"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <ResetPasswordInner />
    </Suspense>
  )
}
