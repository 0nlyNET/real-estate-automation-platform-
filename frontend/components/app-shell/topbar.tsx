"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { LogOut, Moon, Settings, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getInitials } from "@/lib/profile"
import { fetchMe, type Me } from "@/lib/me"

export function Topbar() {
  const [me, setMe] = useState<Me | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    void fetchMe().then((current) => {
      setMe(current)
      if (current?.userId) {
        try { setAvatar(localStorage.getItem(`rta_avatar_${current.userId}`)) } catch {}
      }
    })
  }, [])

  const displayName = me?.email || "Your account"

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
        <div className="text-sm font-medium">RealtyTechAI</div>
        <div className="flex items-center gap-2">
          <div className="hidden text-sm text-muted-foreground sm:block">{displayName}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                <Avatar className="h-8 w-8">
                  {avatar ? <AvatarImage src={avatar} alt="Avatar" /> : null}
                  <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                <Sun className="mr-2 hidden h-4 w-4 dark:block" />
                <Moon className="mr-2 h-4 w-4 dark:hidden" />
                Toggle theme
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/app/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/logout"><LogOut className="mr-2 h-4 w-4" />Logout</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
