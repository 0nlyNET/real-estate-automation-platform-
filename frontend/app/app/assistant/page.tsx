"use client"

import { ShieldCheck } from "lucide-react"
import { PageShell } from "@/app/app/_components/PageShell"
import { RestrictedAssistantChat } from "@/components/ai/restricted-assistant-chat"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export default function ClientAssistantPage() {
  return (
    <PageShell
      title="AI assistant"
      subtitle="Understand your setup, usage, and performance or request a safe configuration change."
    >
      <Alert>
        <ShieldCheck />
        <AlertTitle>Restricted to this workspace</AlertTitle>
        <AlertDescription>
          Conversation history is encrypted and bound to your user and workspace.
          The assistant cannot access provider secrets or another client. Exact
          configuration changes require a workspace administrator to confirm them.
        </AlertDescription>
      </Alert>
      <RestrictedAssistantChat
        endpoint="/ai/client-assistant"
        statusEndpoint="/ai/client-assistant/status"
        title="Ask RealtyTechAI"
        placeholder="Why is SMS not ready? How many leads responded? Change my business hours to 8–6."
        submitLabel="Ask assistant"
        confirmationTitle="Workspace administrator confirmation required"
        confirmationButtonLabel="Confirm these exact changes"
      />
    </PageShell>
  )
}
