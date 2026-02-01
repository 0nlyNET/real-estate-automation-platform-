export type UserRole = "admin" | "client"

export function isAdmin(user: { role?: string } | null) {
  return user?.role === "admin"
}

export function isClient(user: { role?: string } | null) {
  return user?.role === "client"
}
