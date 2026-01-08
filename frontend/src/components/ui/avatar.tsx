import * as AvatarPrimitive from "@radix-ui/react-avatar"
import { cn } from "@/lib/utils"

export function Avatar({ className, ...props }: AvatarPrimitive.AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn("relative flex h-10 w-10 overflow-hidden rounded-full", className)}
      {...props}
    />
  )
}
