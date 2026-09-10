export const clientNavigation = [
  { label: "Today", href: "/app/dashboard" },
  { label: "Leads", href: "/app/leads" },
  { label: "Conversations", href: "/app/inbox" },
  { label: "Appointments", href: "/app/appointments" },
  { label: "Integrations", href: "/app/integrations" },
  { label: "AI assistant", href: "/app/assistant" },
] as const

/**
 * Determines if a pathname is a setup/configuration route that should remain
 * accessible even when the workspace is suspended or has payment issues.
 *
 * @param pathname - The URL pathname to check
 * @returns true if the path is a setup route (billing, onboarding, or settings)
 */
export function isSetupPath(pathname: string) {
  return ["/app/billing", "/app/onboarding", "/app/settings"].includes(pathname.replace(/\/$/, ""))
}
