import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "../components/AppShell";
import { usePlan } from "../components/PlanContext";

type Meter = {
  label: string;
  used: number;
  limit: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function PlanPage() {
  const planCtx = usePlan();
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const p = url.searchParams.get("plan");
    setOverride(p);
  }, []);

  const planName = override || planCtx.planName;

  const meters: Meter[] = useMemo(() => {
    const leadLimit =
      planName === "Freemium" ? 100 : planName === "Starter" ? 1000 : planName === "Pro" ? 5000 : 25000;
    const msgLimit =
      planName === "Freemium" ? 250 : planName === "Starter" ? 2000 : planName === "Pro" ? 12000 : 60000;

    // demo numbers so the UI looks alive
    const usedLeads = planName === "Freemium" ? 23 : planName === "Starter" ? 230 : planName === "Pro" ? 1023 : 8000;
    const usedMsgs = planName === "Freemium" ? 61 : planName === "Starter" ? 980 : planName === "Pro" ? 5400 : 32000;

    return [
      { label: "Leads used", used: usedLeads, limit: leadLimit },
      { label: "Messages sent", used: usedMsgs, limit: msgLimit },
    ];
  }, [planName]);

  const features = useMemo(() => {
    const isStarterPlus = planName === "Starter" || planName === "Pro" || planName === "Enterprise";
    const isProPlus = planName === "Pro" || planName === "Enterprise";

    return [
      { label: "Pipeline + inbox", ok: true },
      { label: "Email automation", ok: isStarterPlus },
      { label: "SMS automation", ok: isProPlus },
      { label: "Unlimited sequences", ok: isProPlus },
      { label: "Webhooks + Zapier key", ok: isProPlus },
      { label: "Team + brokerage controls", ok: planName === "Enterprise" },
    ];
  }, [planName]);

  const right = (
    <div className="flex items-center gap-2">
      <Link
        href="/checkout"
        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
      >
        Upgrade
      </Link>
      <Link
        href="/billing"
        className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/5"
      >
        Billing
      </Link>
    </div>
  );

  return (
    <AppShell title="Plan" subtitle="What you have, what you get, and what unlocks next." right={right}>
      <Head>
        <title>Plan | RealtyTechAI</title>
      </Head>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm text-white/70">Current plan</div>
          <div className="mt-1 text-2xl font-bold text-white">{planName}</div>

          <div className="mt-4 space-y-3">
            {meters.map((m) => {
              const pct = clamp(Math.round((m.used / m.limit) * 100), 0, 100);
              return (
                <div key={m.label} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/80">{m.label}</span>
                    <span className="text-white/60">
                      {m.used.toLocaleString()} / {m.limit.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full bg-white/10">
                    <div className="h-2 rounded-full bg-white/40" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 text-sm text-white/60">
            Tip: Pro unlocks SMS for 23% faster contact rates. Most agents upgrade once they see response time drop.
          </div>
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-white">Features</div>
              <div className="mt-1 text-sm text-white/70">Green = unlocked. Locks explain what you get with Pro.</div>
            </div>
            <Link href="/pricing#compare" className="text-sm font-semibold text-white/80 hover:text-white">
              Compare plans
            </Link>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {features.map((f) => (
              <div key={f.label} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-sm text-white">{f.label}</div>
                <div
                  className={
                    "text-xs font-semibold " + (f.ok ? "text-emerald-300" : "text-white/50")
                  }
                  title={f.ok ? "Unlocked" : "Upgrade to unlock"}
                >
                  {f.ok ? "Unlocked" : "Locked"}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/checkout" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">
              Upgrade plan
            </Link>
            <Link href="/billing" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/5">
              Manage billing
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
