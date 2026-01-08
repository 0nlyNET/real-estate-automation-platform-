"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Lock, CheckCircle2 } from "lucide-react"

interface LockedFeatureModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  feature: string
  requiredPlan: string
}

const planFeatures = {
  Pro: ["Unlimited leads", "Advanced automations", "Priority support", "Template library"],
  Team: ["Everything in Pro", "Up to 10 users", "Team dashboards", "API access", "White-label options"],
}

export function LockedFeatureModal({ open, onOpenChange, feature, requiredPlan }: LockedFeatureModalProps) {
  const router = useRouter()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="text-center">Upgrade to unlock {feature}</DialogTitle>
          <DialogDescription className="text-center">
            This feature requires the {requiredPlan} plan. Upgrade to access advanced capabilities.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-secondary/50 p-4">
          <h4 className="text-sm font-medium text-foreground">{requiredPlan} plan includes:</h4>
          <ul className="mt-3 space-y-2">
            {planFeatures[requiredPlan as keyof typeof planFeatures]?.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 pt-4">
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              onOpenChange(false)
              router.push("/app/billing")
            }}
          >
            Upgrade to {requiredPlan}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
