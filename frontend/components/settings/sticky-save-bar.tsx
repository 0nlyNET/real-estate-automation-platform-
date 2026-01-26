"use client"

import { Button } from "@/components/ui/button"

export function StickySaveBar({
  show,
  saving,
  onCancel,
  onSave,
}: {
  show: boolean
  saving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  if (!show) return null

  return (
    <div className="fixed bottom-4 left-0 right-0 z-40 px-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 p-3 shadow-lg backdrop-blur">
        <div className="min-w-0">
          <div className="text-sm font-medium">Unsaved changes</div>
          <div className="text-xs text-muted-foreground">Save to apply workspace settings immediately.</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  )
}
