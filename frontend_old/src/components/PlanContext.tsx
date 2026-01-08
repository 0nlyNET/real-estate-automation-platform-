import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

type PlanRes = {
  plan?: string;
  status?: "trial" | "active" | "past_due" | "canceled";
  limits?: {
    leadsPerMonth?: number;
    smsPerMonth?: number;
    emailPerMonth?: number;
  };
};

export type PlanContextValue = {
  loading: boolean;
  planName: string;
  status: PlanRes["status"];
  isPreview: boolean;
  // Basic entitlement helpers.
  canReply: boolean;
  canUseAutomation: boolean;
  canSeeAdvancedAnalytics: boolean;
  refresh: () => Promise<void>;
};

const PlanContext = createContext<PlanContextValue | null>(null);

function normalizePlan(p?: string) {
  const s = String(p || "").toLowerCase();
  if (s.includes("enterprise")) return "enterprise";
  if (s.includes("pro")) return "pro";
  if (s.includes("starter")) return "starter";
  if (s.includes("free") || s.includes("freemium")) return "freemium";
  return "starter";
}

export function PlanProvider(props: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<PlanRes | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.get("/me/plan");
      setPlan(res.data || null);
    } catch {
      // If the user is logged out or API is down, keep a safe default.
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<PlanContextValue>(() => {
    const status = plan?.status;
    const normalized = normalizePlan(plan?.plan);

    // UI-only preview rule:
    // Treat "trial" as a read-only preview until Stripe turns on.
    const isPreview = status === "trial" || normalized === "freemium";

    const canReply = !isPreview && (normalized === "starter" || normalized === "pro" || normalized === "enterprise");
    const canUseAutomation = !isPreview && (normalized === "pro" || normalized === "enterprise");
    const canSeeAdvancedAnalytics = !isPreview && (normalized === "pro" || normalized === "enterprise");

    const planName = isPreview ? "Freemium" : plan?.plan || "Starter";

    return {
      loading,
      planName,
      status,
      isPreview,
      canReply,
      canUseAutomation,
      canSeeAdvancedAnalytics,
      refresh,
    };
  }, [loading, plan]);

  return <PlanContext.Provider value={value}>{props.children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) {
    return {
      loading: false,
      planName: "Freemium",
      status: "trial" as const,
      isPreview: true,
      canReply: false,
      canUseAutomation: false,
      canSeeAdvancedAnalytics: false,
      refresh: async () => {},
    };
  }
  return ctx;
}
