import Head from "next/head";
import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import { usePlan } from "../components/PlanContext";

type Meter = {
  label: string;
  used: number;
  limit: number;
  helper: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function PlanPage() {
  const router = useRouter();
  const planCtx = usePlan();

  const override = typeof router.query.plan === "string" ? router.query.plan : "";
  const planName = override || planCtx.planName;

  const meters: Meter[] = useMemo(() => {
    // demo meters based on plan name (UI-only)
    const leadLimit =
      planName === "Freemium" ? 100 :
      planName === "Starter" ? 1000 :
      planName === "Pro" ? 5000 : 25000;

    const msgLimit =
      planName === "Freemium" ? 200 :
      planName === "Starter" ? 2500 :
      planName === "Pro" ? 20000 : 100000;

    // Keep these numbers stable for demos. You can wire to backend usage later.
    const usedLeads = planName === "Freemium" ? 23 : planName === "Starter" ? 73 : planName === "Pro" ? 231 : 1042;
    const usedMsgs = planName === "Freemium" ? 41 : planName === "Starter" ? 312 : planName === "Pro" ? 1834 : 9211;

    return [
      { label: "Leads used", used: usedLeads, limit: leadLimit, helper: "Track pipeline volume per month." },
      { label: "Messages sent", used: usedMsgs, limit: msgLimit, helper: "Email + SMS combined usage." },
    ];
  }, [planName]);

  const features = useMemo(() => {
    const isStarterPlus = planName === "Starter" || planName === "Pro" || planName === "Enterprise";
    const isProPlus = planName === "Pro" || planName === "Enterprise";

    return [
      { label: "Pipeline + stages", ok: true, note: "Always included." },
      { label: "Inbox + templates", ok: true, note: "Reply faster with agent-style quick texts." },
      { label: "Automation sequences", ok: isStarterPlus, note: isStarterPlus ? "Unlimited basic sequences." : "Unlock with Starter." },
      { label: "SMS automation", ok: isProPlus, note: isProPlus ? "Pro unlocks SMS for faster contact rates." : "Upgrade to Pro: $20 more/mo → unlimited sequences + SMS." },
      { label: "Advanced reporting", ok: isProPlus, note: isProPlus ? "Trends + performance insights." : "Unlock with Pro." },
      { label: "Webhooks", ok: isProPlus, note: isProPlus ? "Dev-ready credibility for teams." : "Unlock with Pro." },
      { label: "Brokerage scale", ok: planName === "Enterprise", note: planName === "Enterprise" ? "Custom limits + support." : "Enterprise only." },
    ];
  }, [planName]);

  const success = router.query.success === "true";

  return (
    <AppShell>
      <Head>
        <title>Plan | RealtyTechAI</title>
      </Head>

      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-2xl font-bold text-white">Plan & usage</div>
            <div className="mt-1 text-sm text-white/70">
              This page answers: what do I get, what is unlocked, and what should I do next.
            </div>
          </div>

          <div className="flex gap-2">
            <Link
              href="/checkout"
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
            >
              Upgrade plan
            </Link>
            <Link
              href="/billing"
              className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/5"
            >
              Manage billing
            </Link>
          </div>
        </div>

        {success ? (
          <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            Pro unlocked 🎉 Your features are now available. No refresh needed.
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 md:col-span-1">
            <div className="text-sm font-semibold text-white/70">Current plan</div>
            <div className="mt-2 text-2xl font-bold text-white">{planName || "Freemium"}</div>
            <div className="mt-2 text-sm text-white/70">
              Status: <span className="text-white">{planCtx.status}</span>
            </div>
            <div className="mt-4 text-sm text-white/60">
              Tip: Pro unlocks SMS for faster contact rates.
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <Link
                href="/pricing#compare"
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
              >
                Compare plans
              </Link>
              <button
                onClick={() => planCtx.refresh()}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/5"
              >
                Refresh status
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 md:col-span-2">
            <div className="text-sm font-semibold text-white/70">Usage meters</div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {meters.map((m) => {
                const pct = clamp(Math.round((m.used / m.limit) * 100), 0, 100);
                return (
                  <div key={m.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">{m.label}</div>
                      <div className="text-xs text-white/60">
                        {m.used.toLocaleString()} / {m.limit.toLocaleString()}
                      </div>
                    </div>
                    <div className="mt-3 h-2 w-full rounded-full bg-white/10">
                      <div className="h-2 rounded-full bg-white/40" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-white/60">{m.helper}</div>
                    {pct >= 80 ? (
                      <div className="mt-2 text-xs text-amber-200">
                        Getting close. Upgrade to avoid limits during busy weeks.
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-semibold text-white/70">Feature checklist</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {features.map((f) => (
              <div key={f.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-white">{f.label}</div>
                  <div className={`text-xs font-semibold ${f.ok ? "text-emerald-200" : "text-white/50"}`}>
                    {f.ok ? "Unlocked" : "Locked"}
                  </div>
                </div>
                <div className="mt-2 text-xs text-white/60">{f.note}</div>
                {!f.ok ? (
                  <div className="mt-3">
                    <Link
                      href="/pricing#compare"
                      className="inline-flex rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15"
                    >
                      Upgrade to unlock
                    </Link>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-semibold text-white/70">Next actions</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/integrations" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">
              Open integrations
            </Link>
            <Link href="/leads" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/5">
              View pipeline
            </Link>
            <Link href="/inbox" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/5">
              Go to inbox
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
