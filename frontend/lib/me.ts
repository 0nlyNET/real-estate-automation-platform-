import { ApiError, apiFetch } from "@/lib/api";

export type Me = {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
  isPlatformAdmin: boolean;
  platformRole: "super_admin" | "staff" | null;
  impersonated: boolean;
  impersonatedBy: { userId: string; email: string } | null;
  sessionExpiresAt: string | null;
};

let pendingSession: Promise<Me> | null = null;

/**
 * Fetches the current authenticated session with request deduplication,
 * falling back to legacy /me endpoint if /auth/session is not available.
 * Throws ApiError on authentication failures.
 *
 * @returns Promise resolving to session details
 * @throws ApiError with status 401 if session is expired
 */
export function fetchSession(): Promise<Me> {
  if (!pendingSession) {
    pendingSession = apiFetch<Me>("/auth/session").catch((cause) => {
      if (cause instanceof ApiError && cause.status === 404) return apiFetch<Me>("/me");
      throw cause;
    }).finally(() => { pendingSession = null; });
  }
  return pendingSession;
}

/**
 * Legacy wrapper around fetchSession that returns null on any error instead of
 * throwing. Route guards should use fetchSession directly to distinguish
 * unavailable services from expired sessions.
 *
 * @returns Promise resolving to session details or null if unavailable
 */
// Legacy callers use this only to display identity/role. Route guards use
// fetchSession directly so they can distinguish unavailable from signed out.
export async function fetchMe(): Promise<Me | null> {
  try {
    const d = await fetchSession();
    if (!d?.userId) return null;
    return d;
  } catch {
    return null;
  }
}
