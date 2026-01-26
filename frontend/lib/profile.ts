export function decodeJwtSub(token: string | null): string | null {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length < 2) return null
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    return typeof json?.sub === "string" ? json.sub : null
  } catch {
    return null
  }
}

export function getDisplayName(token: string | null): string {
  if (!token) return "Your account"
  const parts = token.split(".")
  if (parts.length < 2) return "Your account"
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    const name = String(json?.fullName || json?.name || "").trim()
    if (name) return name
    const email = String(json?.email || "").trim()
    if (email) return email
    return "Your account"
  } catch {
    return "Your account"
  }
}

export function getInitials(name: string): string {
  const n = String(name || "").trim()
  if (!n) return "U"
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function avatarKeyForSub(sub: string) {
  return `rta_avatar_${sub}`
}

export function getAvatarDataUrl(token: string | null): string | null {
  const sub = decodeJwtSub(token)
  if (!sub) return null
  try {
    return localStorage.getItem(avatarKeyForSub(sub))
  } catch {
    return null
  }
}

export function setAvatarDataUrl(token: string | null, dataUrl: string | null) {
  const sub = decodeJwtSub(token)
  if (!sub) return
  try {
    const key = avatarKeyForSub(sub)
    if (!dataUrl) localStorage.removeItem(key)
    else localStorage.setItem(key, dataUrl)

    // tell Topbar (and anyone else) to refresh instantly
    window.dispatchEvent(new CustomEvent("rta:avatar-updated", { detail: { sub } }))
  } catch {}
}
