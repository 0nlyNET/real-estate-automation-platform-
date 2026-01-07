import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import { api } from "../lib/api";
import { getToken, logout } from "../lib/auth";

type Plan = {
  plan: string;
  status: "trial" | "active" | "past_due" | "canceled";
  limits: {
    leadsPerMonth: number;
    smsPerMonth: number;
    emailPerMonth: number;
  };
};

export default function BillingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/me/plan");
      setPlan(res.data);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        logout("/login");
        return;
      }
      setError(String(err?.response?.data?.message || err?.message || "Failed to load plan"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return (
    <AppShell
      title="Plan"
      subtitle="Manage your subscription"
      right={
        <button className="btn btnGhost" type="button" onClick={load}>Refresh</button>
      }
    >
      {loading ? <div className="card" style={{ marginTop: 14 }}><div className="muted">Loading...</div></div> : null}
      {!loading && error ? (
        <div className="card" style={{ marginTop: 14, borderColor: "rgba(239, 68, 68, 0.35)" }}>{error}</div>
      ) : null}

      {!loading && !error && !plan ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h1">Pick a plan to go live</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Turn on instant texting and follow-ups for every new lead.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button className="btn" type="button" onClick={() => alert("Stripe checkout coming next")}>Start Starter plan</button>
            <button className="btn btnGhost" type="button" onClick={() => alert("Contact flow coming next")}>Talk to us</button>
          </div>
        </div>
      ) : null}

      {!loading && !error && plan ? (
        <>
          <div className="grid2" style={{ marginTop: 14 }}>
            <div className="card">
              <div className="muted">Current plan</div>
              <div className="h1" style={{ marginTop: 6 }}>{plan.plan}</div>
              <div className="small" style={{ marginTop: 8 }}>
                Status: <span className="badge">{plan.status}</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button className="btn" type="button" onClick={() => router.push("/checkout")}>Upgrade</button>
                <button className="btn btnGhost" type="button" onClick={() => router.push("/checkout")}>Update payment</button>
                <button className="btn btnGhost" type="button" onClick={() => alert("Cancel flow: Phase 2 (Stripe).")}>Cancel plan</button>
              </div>
            </div>

            <div className="card">
              <div className="muted">Usage this month</div>
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <div className="listRow"><span>Texts sent</span><strong>0 / {plan.limits.smsPerMonth.toLocaleString()}</strong></div>
                <div className="listRow"><span>Emails sent</span><strong>0 / {plan.limits.emailPerMonth.toLocaleString()}</strong></div>
                <div className="listRow"><span>Leads added</span><strong>0 / {plan.limits.leadsPerMonth.toLocaleString()}</strong></div>
                <div className="small muted">Usage counters will populate once messaging is connected.</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 950 }}>Billing</div>
            <div className="muted" style={{ marginTop: 6 }}>
              Stripe checkout, invoices, and trials can be enabled next. This page is already wired to read per-tenant plan data.
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
