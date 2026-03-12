"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { Logo } from "@/components/logo";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <Logo href="/" size="lg" />
          </div>

          <Card className="border-border bg-card">
            <CardHeader className="pb-4 text-center">
              <h1 className="text-2xl font-bold text-foreground">Account setup is managed for you</h1>
              <p className="text-sm text-muted-foreground">
                RealtyTechAI is currently onboarded as a service, not self-serve signup.
              </p>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                If you are a client or team member, your account should be created by the RealtyTechAI operator.
                Use the login page if you already have credentials, or contact support to get onboarded.
              </div>

              <div className="flex flex-col gap-3">
                <Button asChild className="w-full">
                  <Link href="/login">Go to login</Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/contact">Contact support</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Footer />
    </div>
  );
}
