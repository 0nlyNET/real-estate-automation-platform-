import { useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import Link from "next/link";
import { useRouter } from "next/router";

type PlanId = "Starter" | "Pro" | "Enterprise";

const PRICING = {
  Starter: { monthly: 49, yearly: 490 },
  Pro: { monthly: 69, yearly: 690 },
  Enterprise: { monthly: 199, yearly: 1990 },
} as const;

export default function CheckoutPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [plan, setPlan] = useState<PlanId>("Pro");

  const price = useMemo(() => {
    const p = PRICING[plan];
    return billing === "monthly" ? p.monthly : p.yearly;
  }, [billing, plan]);

  function startCheckout() {
    // Stripe-ready stub: in production this redirects to Stripe Checkout session URL
    // For now, we simulate instant unlock and route to /plan?success=true.
    const nextPlan = plan;
    localStorage.setItem("rtai_plan_override_v1", nextPlan);
    router.push("/plan?success=true");
  }

  return (
    <AppShell
      title="Checkout"
      subtitle="Choose a plan and unlock instantly after payment."
      right={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn btnGhost" href="/pricing">
            View pricing
          </Link>
          <Link className="btn btnGhost" href="/plan">
            My plan
          </Link>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 14, alignItems: "start" }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Select plan</div>
          <div className="muted" style={{ marginTop: 4 }}>
            Cancel anytime. No confusion. Built for speed-to-lead.
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className={billing === "monthly" ? "btn" : "btn btnGhost"} type="button" onClick={() => setBilling("monthly")}>
              Monthly
            </button>
            <button className={billing === "yearly" ? "btn" : "btn btnGhost"} type="button" onClick={() => setBilling("yearly")}>
              Yearly
            </button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {(["Starter", "Pro", "Enterprise"] as PlanId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={"card"}
                onClick={() => setPlan(id)}
                style={{
                  padding: 14,
                  textAlign: "left",
                  cursor: "pointer",
                  borderColor: plan === id ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.10)",
                  background: plan === id ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <div style={{ fontWeight: 900 }}>{id}</div>
                  <div style={{ fontWeight: 900 }}>
                    ${billing === "monthly" ? PRICING[id].monthly : PRICING[id].yearly}
                    <span className="muted" style={{ fontWeight: 800 }}>
                      /{billing}
                    </span>
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {id === "Starter" ? "Solo agents: get real automation without the bloat." : null}
                  {id === "Pro" ? "Most teams run everything here—SMS + unlimited power." : null}
                  {id === "Enterprise" ? "For brokerages, teams, franchises, high-volume orgs—custom scale." : null}
                </div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={startCheckout}>
              Continue to payment
            </button>
            <Link className="btn btnGhost" href="/integrations">
              Integrations
            </Link>
          </div>

          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Stripe Checkout redirect: enabled in Phase 2. This patch keeps the UX smooth and Stripe-ready without risking stability.
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>What you unlock</div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <div className="listRow">
              <span>Instant unlock after payment</span>
              <strong>Yes</strong>
            </div>
            <div className="listRow">
              <span>SMS automation</span>
              <strong>{plan === "Starter" ? "Limited" : "Unlimited"}</strong>
            </div>
            <div className="listRow">
              <span>Sequences</span>
              <strong>{plan === "Starter" ? "Starter pack" : "Unlimited"}</strong>
            </div>
            <div className="listRow">
              <span>Webhooks</span>
              <strong>{plan === "Pro" || plan === "Enterprise" ? "Enabled" : "Locked"}</strong>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 900 }}>Trust</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Cancel anytime. Your pipeline stays clean. No spammy tricks.
              </div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div className="muted">Today total</div>
              <div style={{ fontSize: 28, fontWeight: 1000, marginTop: 2 }}>${price}</div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
