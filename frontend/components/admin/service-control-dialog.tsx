"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type ServiceControlDialogProps = {
  action: "suspend" | "restore" | null
  clientName: string
  busy: boolean
  error?: string
  onOpenChange: (open: boolean) => void
  onConfirm: (reason?: string) => void
}

export function ServiceControlDialog({
  action,
  clientName,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: ServiceControlDialogProps) {
  const [reason, setReason] = useState("")

  const suspending = action === "suspend"

  return (
    <AlertDialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open) setReason("")
        onOpenChange(open)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {suspending ? `Suspend services for ${clientName}?` : `Restore services for ${clientName}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {suspending
              ? "This client-wide control takes effect immediately. Client and lead records remain available."
              : "Restoration succeeds only after billing is eligible. Previously active sequences may resume after the safety delay."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {suspending ? (
          <div className="space-y-4">
            <ul className="space-y-1.5 rounded-md bg-muted/60 p-4 text-sm" aria-label="Effects of suspension">
              <li>Stops automated SMS and email</li>
              <li>Stops sequences and reminders</li>
              <li>Preserves client and lead data</li>
              <li>Preserves conversations and history</li>
            </ul>
            <div className="space-y-2">
              <Label htmlFor="service-suspension-reason">Suspension reason</Label>
              <Textarea
                id="service-suspension-reason"
                value={reason}
                minLength={3}
                maxLength={1000}
                required
                aria-describedby="service-suspension-help"
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why services must stop and what must be resolved."
              />
              <p id="service-suspension-help" className="text-xs text-muted-foreground">
                This reason is retained with the service record and shown to authorized administrators.
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={suspending ? "destructive" : "default"}
            disabled={busy || (suspending && reason.trim().length < 3)}
            onClick={() => onConfirm(suspending ? reason.trim() : undefined)}
          >
            {busy ? "Saving…" : suspending ? "Suspend services" : "Restore services"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
