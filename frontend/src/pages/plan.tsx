import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import Link from "next/link";
import { useRouter } from "next/router";
import { usePlan } from "../components/PlanContext";
import UpgradePopover from "../components/UpgradePopover";

type Meter = { label: string; used: number; limit: number; unit?: string };

export default function PlanPage() {
  const router = useRouter();
  const planCtx = usePlan();
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    const ov = localStorage.getItem("rtai_plan_override_v1");
    setOverride(ov);
  }, []);

  const planName = override || planCtx.plan;

  const meters: Meter[] = useMemo(() => {
    const base = planName === "Freemium" ? 100 : planName === "Starter" ? 1000 : planName === "Pro" ? 5000 : 25000;
    return [
      { label: "Leads used", used: 23, limit: base },
      { label: "Messages sent", used: 91, limit: planName === "Freemium" ? 50 : planName === "Starter" ? 500 : planName === "Pro" ? 5000 : 25000 },
    ];
  }, [planName]);

  const unlocked = {
    sms: planName === "Pro" || planName === "Enterprise",
    sequences: planName !== "Freemium",
    webhooks: planName === "Pro" || planName === "Enterprise",
    facebook: planName !== "Freemium",
    export: planName !== "Freemium",
  };

  useEffect(() => {
    if (router.query.success === "true") {
      // keep it simple, no toast system dependency
      // eslint-disable-next-line no-alert
      alert("Pro unlocked 🎉");
    }
  }, [router.query.success]);

  return (
    <AppShell
      title="Plan"
      subtitle="Everything you get, what’s unlocked, and your usage."
      right={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn" href="/checkout">
            Upgrade plan
          </Link>
          <Link className="btn btnGhost" href="/billing">
            Manage billing
          </Link>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Current plan
              </div>
              <div style={{ fontSize: 24, fontWeight: 1000, marginTop: 2 }}>{planName}</div>
            </div>
            <div className="pill">Active</div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {meters.map((m) => (
              <div key={m.label} className="card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{m.label}</div>
                  <div className="muted">
                    {m.used.toLocaleString()} / {m.limit.toLocaleString()}
                  </div>
                </div>
                <div style={{ marginTop: 8, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.round((m.used / m.limit) * 100))}%`,
                      background: "rgba(255,255,255,0.20)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Features</div>
          <div className="muted" style={{ marginTop: 4 }}>
            Green check means unlocked. Locks show what upgrades unlock.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <FeatureRow label="SMS Automation" ok={unlocked.sms} upgradeLabel="Upgrade to Pro for unlimited SMS sequences" />
            <FeatureRow label="Unlimited Sequences" ok={unlocked.sequences} upgradeLabel="Starter unlocks sequences" />
            <FeatureRow label="Webhooks" ok={unlocked.webhooks} upgradeLabel="Pro unlocks Webhooks for dev workflows" />
            <FeatureRow label="Facebook Lead Ads (Phase 1)" ok={unlocked.facebook} upgradeLabel="Unlock to connect Facebook leads" />
            <FeatureRow label="CSV Export" ok={unlocked.export} upgradeLabel="Starter+ unlocks exports" />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn" href="/checkout">
              Upgrade plan
            </Link>
            <Link className="btn btnGhost" href="/integrations">
              Integrations
            </Link>
            <Link className="btn btnGhost" href="/pricing#compare">
              Compare plans
            </Link>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Billing</div>
          <div className="muted" style={{ marginTop: 4 }}>
            View invoices and manage payment method.
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn" href="/billing">
              Manage billing
            </Link>
            <button className="btn btnGhost" type="button" onClick={() => alert("Invoices show here in Phase 2.")}>
              View invoices
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FeatureRow(props: { label: string; ok: boolean; upgradeLabel: string }) {
  if (props.ok) {
    return (
      <div className="listRow">
        <span>{props.label}</span>
        <strong style={{ color: "rgba(34,197,94,0.95)" }}>✓ Unlocked</strong>
      </div>
    );
  }

  return (
    <div className="listRow" style={{ opacity: 0.9 }}>
      <span>{props.label}</span>
      <UpgradePopover featureName={props.label} message={props.upgradeLabel}>
        <strong style={{ opacity: 0.8 }}>🔒 Locked</strong>
      </UpgradePopover>
    </div>
  );
}
