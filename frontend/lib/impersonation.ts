export const IMPERSONATION_TOKEN_KEY = 'rta_impersonation_token_v1'
export const IMPERSONATION_USER_KEY = 'rta_impersonation_user_v1'
export const AUTH_CHANGED_EVENT = 'rta:auth-changed'

type ImpersonatedUser = {
  id: string
  email: string
  role: string
  tenantId?: string
}

function tokenExpiresAt(token: string): number | null {
  try {
    const encoded = token.split('.')[1]
    if (!encoded) return null
    const padded = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded))
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function setAuthCookie(token: string | null) {
  if (!token) {
    document.cookie = 'rtai_token=; Path=/; Max-Age=0; SameSite=Lax'
    return
  }
  const expiresAt = tokenExpiresAt(token)
  const maxAge = expiresAt
    ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
    : 60 * 60 * 24 * 7
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `rtai_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
}

function notifyAuthChanged() {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT))
}

export function getImpersonationToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(IMPERSONATION_TOKEN_KEY)
  } catch {
    return null
  }
}

export function getImpersonatedUserRaw(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(IMPERSONATION_USER_KEY)
  } catch {
    return null
  }
}

export function getEffectiveToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return (
      sessionStorage.getItem(IMPERSONATION_TOKEN_KEY) ||
      localStorage.getItem('rta_token')
    )
  } catch {
    return null
  }
}

export function startImpersonation(token: string, user: ImpersonatedUser) {
  sessionStorage.setItem(IMPERSONATION_TOKEN_KEY, token)
  sessionStorage.setItem(IMPERSONATION_USER_KEY, JSON.stringify(user))
  // Keep the primary admin cookie in place. Cookies are shared across tabs,
  // while this intentionally tab-scoped support session uses sessionStorage.
  notifyAuthChanged()
}

export function endImpersonation() {
  try {
    sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY)
    sessionStorage.removeItem(IMPERSONATION_USER_KEY)
  } catch {}

  let primaryToken: string | null = null
  try {
    primaryToken = localStorage.getItem('rta_token')
  } catch {}
  setAuthCookie(primaryToken)
  notifyAuthChanged()
  return Boolean(primaryToken)
}

export function exitImpersonation(destination = '/admin/dashboard') {
  const restored = endImpersonation()
  window.location.assign(restored ? destination : '/login')
}
