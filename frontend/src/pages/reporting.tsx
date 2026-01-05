import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import EmptyState from "../components/EmptyState";
import StatCard from "../components/StatCard";
import { api } from "../lib/api";
import { getToken, logout } from "../lib/auth";
import { copy } from "../content/copy";

type StatsOverview = {
  totalLeads: number;
  activeLeads: number;
  hotLeads: number;
  todayLeads: number;
};

export default function ReportingPage() {
  const router = useRouter();
  const [range, setRange] = useState<"today" | "7" | "30">("7");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<StatsOverview | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/stats/overview", { params: { range } });
      setStats(res.data);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        logout("/login");
        return;
      }
      setError(String(err?.response?.data?.message || err?.message || "Failed to load reporting"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, range]);

  const empty = useMemo(() => {
    return !loading && !error && (stats?.totalLeads ?? 0) === 0;
  }, [loading, error, stats]);

  return (
    <AppShell
      title={copy.reporting.title}
      subtitle={copy.reporting.subtitle}
      right={
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={range} onChange={(e) => setRange(e.target.value as any)}>
            <option value="today">Today</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
          <button className="btn btnGhost" type="button" onClick={load}>
            {copy.global.refresh}
          </button>
        </div>
      }
    >
      {loading ? <div className="muted">Loading...</div> : null}
      {!loading && error ? (
        <div className="card" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
          {error}
        </div>
      ) : null}

      {empty ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState
            title={copy.reporting.empty.title}
            body={copy.reporting.empty.body}
            primary={{ label: copy.reporting.empty.primary, href: "/leads" }}
            secondary={{ label: copy.reporting.empty.secondary, href: "/leads?sample=1" }}
          />
        </div>
      ) : null}

      {!loading && !error && stats ? (
        <>
          <div style={{ marginTop: 14 }}>
            <div className="statGrid">
              <StatCard label="Avg speed-to-lead" value="—" sub="Coming soon" onClick={() => router.push("/dashboard")} />
              <StatCard label="Leads contacted instantly" value="—" sub="Requires SMS/email wiring" onClick={() => router.push("/settings")} />
              <StatCard label="Reply rate" value="—" sub="Requires inbox" onClick={() => router.push("/inbox")} />
              <StatCard label="Appointments booked" value="—" sub="Coming soon" onClick={() => router.push("/dashboard")} />
            </div>
          </div>

          <div className="grid2" style={{ marginTop: 14 }}>
            <div className="card">
              <div style={{ fontWeight: 950 }}>Lead sources</div>
              <div className="muted" style={{ marginTop: 8 }}>
                Once lead sources are connected, you’ll see which ones create the most appointments and replies.
              </div>
              <div className="small" style={{ marginTop: 12 }}>
                Quick start: connect Facebook leads or a website form in Settings.
              </div>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => router.push("/settings#sources")}>Connect a source</button>
            </div>

            <div className="card">
              <div style={{ fontWeight: 950 }}>Follow-up performance</div>
              <div className="muted" style={{ marginTop: 8 }}>
                When sequences are enabled, this shows which steps get the most replies.
              </div>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => router.push("/settings#followups")}>Review follow-ups</button>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 950 }}>Snapshot</div>
            <div className="small" style={{ marginTop: 8 }}>
              Leads total: <b>{stats.totalLeads}</b> · Active: <b>{stats.activeLeads}</b> · Hot: <b>{stats.hotLeads}</b> · New today: <b>{stats.todayLeads}</b>
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
