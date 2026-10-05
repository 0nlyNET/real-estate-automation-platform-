"use client"

import { Settings2, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { PageShell } from "@/app/app/_components/PageShell"
import { RestrictedAssistantChat } from "@/components/ai/restricted-assistant-chat"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export default function ClientAssistantPage() {
  return (
    <PageShell
      title="AI assistant"
      subtitle="Understand your setup, usage, and performance or request a safe configuration change."
    >
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/app/assistant/settings">
            <Settings2 className="h-4 w-4" /> Assistant settings
          </Link>
        </Button>
      </div>
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
