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

export function fetchSession(): Promise<Me> {
  if (!pendingSession) {
    pendingSession = apiFetch<Me>("/auth/session").catch((cause) => {
      if (cause instanceof ApiError && cause.status === 404) return apiFetch<Me>("/me");
      throw cause;
    }).finally(() => { pendingSession = null; });
  }
  return pendingSession;
}

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
