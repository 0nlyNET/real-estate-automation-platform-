"use client"

import { ShieldAlert } from "lucide-react"
import { useAdminSession } from "@/app/admin/admin-access-guard"
import { RestrictedAssistantChat } from "@/components/ai/restricted-assistant-chat"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/**
 * The Operations AI assistant body, shared by the standalone
 * /admin/assistant route and the ?view=operations-ai dashboard deep link.
 * The page heading lives with each host: the standalone page renders its
 * own, while the dashboard renders its generic per-view header.
 */
export function OperationsAssistantView() {
  const session = useAdminSession()
  return (
    <div className="space-y-6">
      <Alert>
        <ShieldAlert />
        <AlertTitle>Safety boundary</AlertTitle>
        <AlertDescription>
          This assistant cannot refund payments, change prices, delete tenants,
          release numbers, rotate parent credentials, override opt-outs, approve
          compliance, or disable global safeguards. Recovery mutations are
          available only to the super administrator and require one-time
          confirmation.
        </AlertDescription>
      </Alert>
      <RestrictedAssistantChat
        endpoint="/admin/ai/operations-assistant"
        statusEndpoint="/admin/ai/provider-test"
        providerTestEndpoint="/admin/ai/provider-test"
        canTestProvider={session.platformRole === "super_admin"}
        title="Investigate an exception"
        placeholder="Summarize current exceptions and suggest the next safe recovery action."
        submitLabel="Ask Operations AI"
        confirmationTitle="Super-administrator confirmation required"
        confirmationButtonLabel="Confirm these exact recovery actions"
      />
    </div>
  )
}
