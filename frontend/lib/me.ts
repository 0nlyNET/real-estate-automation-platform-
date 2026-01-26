import { apiFetch } from "@/lib/api";
import type { MePlan, PlanName } from "@/lib/plan";

export type Me = {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
};

export type MeWithPlan = {
  me: Me | null;
  plan: MePlan | null;
  planName: PlanName;
};

export async function fetchMe(): Promise<Me | null> {
  try {
    const d = await apiFetch<Me>("/me");
    if (!d || !(d as any).userId) return null;
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

  const planName: PlanName = (plan?.plan as any) || "pro";
  return { me, plan, planName };
}
