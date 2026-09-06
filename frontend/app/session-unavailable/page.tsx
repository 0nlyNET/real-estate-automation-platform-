"use client"

import { Button } from "@/components/ui/button"

export default function SessionUnavailablePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center" role="alert">
      <h1 className="text-xl font-semibold">We could not check your session</h1>
      <p className="text-sm text-muted-foreground">The service is temporarily unavailable. Your sign-in has been kept. Retry to return to this page.</p>
      <Button onClick={() => window.location.reload()}>Try again</Button>
    </main>
  )
}
