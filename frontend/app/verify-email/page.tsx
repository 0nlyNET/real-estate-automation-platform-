"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { Mail, Loader2, ArrowLeft } from "lucide-react"
import { Footer } from "@/components/ui/footer"

export default function VerifyEmailPage() {
  const { toast } = useToast()
  const [resending, setResending] = useState(false)

  const handleResend = async () => {
    setResending(true)

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500))

    toast({
      title: "Email sent!",
      description: "A new verification email has been sent to your inbox.",
    })

    setResending(false)
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Link href="/" className="inline-flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
                <span className="text-lg font-bold text-primary-foreground">R</span>
              </div>
              <span className="text-xl font-semibold text-foreground">RealtyTechAI</span>
            </Link>
          </div>

          <Card className="border-border bg-card">
            <CardHeader className="pb-4 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Mail className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">Check your email</h1>
              <p className="text-sm text-muted-foreground">
                We've sent a verification link to your email address. Click the link to verify your account.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-secondary/50 p-4">
                <h3 className="text-sm font-medium text-foreground">Didn't receive the email?</h3>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>Check your spam or junk folder</li>
                  <li>Make sure you entered the correct email</li>
                  <li>Wait a few minutes and try again</li>
                </ul>
              </div>

              <Button variant="outline" className="w-full bg-transparent" onClick={handleResend} disabled={resending}>
                {resending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Resend verification email"
                )}
              </Button>

              <Link
                href="/login"
                className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      <Footer />
    </div>
  )
}
