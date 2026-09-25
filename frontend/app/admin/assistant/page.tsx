import { OperationsAssistantView } from "@/components/ai/operations-assistant-view"

export default function OperationsAssistantPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations AI</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Diagnose exceptions and request bounded, auditable recovery actions.
        </p>
      </div>
      <OperationsAssistantView />
    </div>
  )
}
