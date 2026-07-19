"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

function UnsubscribeContent() {
  const params = useSearchParams()
  const [message, setMessage] = useState("Processing your request…")

  useEffect(() => {
    const token = params.get("token") || ""
    if (!token) return setMessage("This unsubscribe link is invalid.")
    void fetch(`/api/backend/public/unsubscribe?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || "The unsubscribe link is invalid or expired.")
        setMessage(result.message || "You have been unsubscribed from email messages.")
      })
      .catch((cause) => setMessage(cause instanceof Error ? cause.message : "The request could not be completed."))
  }, [params])

  return <main className="flex min-h-screen items-center justify-center bg-background px-4"><Card className="w-full max-w-lg"><CardHeader><h1 className="text-2xl font-semibold">Email preferences</h1></CardHeader><CardContent><p>{message}</p></CardContent></Card></main>
}

export default function UnsubscribePage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center">Loading…</main>}><UnsubscribeContent /></Suspense>
}
