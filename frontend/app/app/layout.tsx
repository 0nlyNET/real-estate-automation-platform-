import type React from "react"
import { ClientAccessGuard } from "./client-access-guard"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ClientAccessGuard>{children}</ClientAccessGuard>
}
