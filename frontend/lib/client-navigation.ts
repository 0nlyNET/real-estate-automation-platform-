export const clientNavigation = [
  { label: "Today", href: "/app/dashboard" },
  { label: "Leads", href: "/app/leads" },
  { label: "Conversations", href: "/app/inbox" },
  { label: "Appointments", href: "/app/appointments" },
  { label: "Integrations", href: "/app/integrations" },
  { label: "AI assistant", href: "/app/assistant" },
] as const

export function isSetupPath(pathname: string) {
  return ["/app/billing", "/app/onboarding", "/app/settings"].includes(pathname.replace(/\/$/, ""))
}
