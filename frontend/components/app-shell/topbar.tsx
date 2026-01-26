"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getAvatarDataUrl, getDisplayName, getInitials } from "@/lib/profile"

export function Topbar() {
  const [token, setToken] = useState<string | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    try {
      setToken(localStorage.getItem("rta_token"))
    } catch {
      setToken(null)
    }
  }, [])

  useEffect(() => {
    setAvatar(getAvatarDataUrl(token))
  }, [token])

  useEffect(() => {
    function onAvatarUpdated() {
      setAvatar(getAvatarDataUrl(token))
    }
    window.addEventListener("rta:avatar-updated", onAvatarUpdated as any)
    return () => window.removeEventListener("rta:avatar-updated", onAvatarUpdated as any)
  }, [token])

  const displayName = useMemo(() => getDisplayName(token), [token])
  const initials = useMemo(() => getInitials(displayName), [displayName])

  const isDark = mounted ? (resolvedTheme ?? "dark") === "dark" : true

  function toggleTheme() {
    setTheme(isDark ? "light" : "dark")
  }

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">RealtyTechAI</div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden text-sm text-muted-foreground sm:block">{displayName}</div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                <Avatar className="h-8 w-8">
                  {avatar ? <AvatarImage src={avatar} alt="Avatar" /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={toggleTheme}>
                {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                {isDark ? "Switch to light mode" : "Switch to dark mode"}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem asChild>
                <Link href="/app/settings">Settings</Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem asChild>
                <Link href="/logout">Logout</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
