import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface LogoProps {
  href?: string
  showText?: boolean
  size?: "sm" | "md" | "lg"
  className?: string
}

const sizeMap = {
  sm: { icon: 28, text: "text-base" },
  md: { icon: 36, text: "text-lg" },
  lg: { icon: 44, text: "text-xl" },
}

export function Logo({ href, showText = true, size = "md", className }: LogoProps) {
  const { icon, text } = sizeMap[size]

  const content = (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/images/tech-20house-20logo-20with-20circuit-20lines.png"
        alt="RealtyTechAI Logo"
        width={icon}
        height={icon}
        className="shrink-0"
      />
      {showText && (
        <span className={cn("font-heading font-semibold tracking-tight text-foreground", text)}>RealtyTechAI</span>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="transition-opacity hover:opacity-90">
        {content}
      </Link>
    )
  }

  return content
}
