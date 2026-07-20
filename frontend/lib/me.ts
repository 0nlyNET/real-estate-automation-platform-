import { apiFetch } from "@/lib/api";

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

export async function fetchMe(): Promise<Me | null> {
  try {
    const d = await apiFetch<Me>("/me");
    if (!d?.userId) return null;
    return d;
  } catch {
    return null;
  }
}
