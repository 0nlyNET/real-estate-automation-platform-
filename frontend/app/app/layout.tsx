import type React from "react"
import { ClientAccessGuard } from "./client-access-guard"
import { OperatorModeBanner } from "@/components/app-shell/operator-mode-banner"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientAccessGuard>
      <OperatorModeBanner />
      {children}
    </ClientAccessGuard>
  )
}
