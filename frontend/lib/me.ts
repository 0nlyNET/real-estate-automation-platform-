import { apiFetch } from "@/lib/api";
import type { MePlan, PlanName } from "@/lib/plan";

export type Me = {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
  isPlatformAdmin: boolean;
  impersonated: boolean;
  impersonatedBy: { userId: string; email: string } | null;
  sessionExpiresAt: string | null;
};

export type MeWithPlan = {
  me: Me | null;
  plan: MePlan | null;
  planName: PlanName;
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

export async function fetchMeWithPlan(): Promise<MeWithPlan> {
  const [me, plan] = await Promise.all([
    fetchMe(),
    (async () => {
      try {
        const p = await apiFetch<MePlan>("/me/plan");
        return p || null;
      } catch {
        return null;
      }
    })(),
  ]);

  const planName: PlanName = plan?.plan || "free";
  return { me, plan, planName };
}
