export default function CompliancePage() {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Messaging Compliance</h1>
      <p className="text-sm text-muted-foreground">
        You are responsible for obtaining consent before sending SMS or email marketing messages. Provide clear opt-out instructions and honor STOP requests.
      </p>
      <p className="text-sm text-muted-foreground">
        If a recipient replies STOP, you must stop messaging them unless they re-consent.
      </p>
    </div>
  )
}
