import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import EmptyState from "../components/EmptyState";
import StatCard from "../components/StatCard";
import LockedFeature from "../components/LockedFeature";
import { usePlan } from "../components/PlanContext";
import { api } from "../lib/api";
import { getToken, logout } from "../lib/auth";
import { copy } from "../content/copy";
import { formatDuration } from "../lib/time";

type StatsOverview = {
  totalLeads: number;
  activeLeads: number;
  hotLeads: number;
  todayLeads: number;
};

type Lead = {
  id: string;
  source?: string;
  createdAt?: string;
  lastContactedAt?: string;
};

export default function ReportingPage() {
  const router = useRouter();
  const plan = usePlan();
  const [range, setRange] = useState<"today" | "7" | "30">("7");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/stats/overview", { params: { range } });
      setStats(res.data);
      const lr = await api.get("/leads", { params: { limit: 500 } });
      setLeads(lr.data?.items || lr.data || []);
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

  const rangeMs = range === "today" ? 24 * 60 * 60 * 1000 : range === "30" ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const since = Date.now() - rangeMs;

  const analytics = useMemo(() => {
    const inRange = leads.filter((l) => (l.createdAt ? new Date(l.createdAt).getTime() >= since : false));
    const replied = inRange.filter((l) => l.createdAt && l.lastContactedAt);
    const resp = replied
      .map((l) => new Date(l.lastContactedAt!).getTime() - new Date(l.createdAt!).getTime())
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);
    const avg = resp.length ? resp.reduce((a, b) => a + b, 0) / resp.length : 0;
    const p50 = resp.length ? resp[Math.floor(resp.length * 0.5)] : 0;

    const bySource: Record<string, number> = {};
    inRange.forEach((l) => {
      const k = (l.source || "Unknown").trim() || "Unknown";
      bySource[k] = (bySource[k] || 0) + 1;
    });
    const sources = Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => ({ source: k, count: v }));

    return {
      inRangeCount: inRange.length,
      repliedCount: replied.length,
      avgResponseMs: avg,
      p50ResponseMs: p50,
      sources,
    };
  }, [leads, since]);

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
              <StatCard
                label="Avg speed-to-lead"
                value={analytics.avgResponseMs ? `${Math.round(analytics.avgResponseMs / 60000)}m` : "—"}
                sub={analytics.avgResponseMs ? "Avg first reply time" : "Reply tracking starts when you send messages"}
              />
              <StatCard
                label="Median speed-to-lead"
                value={analytics.p50ResponseMs ? `${Math.round(analytics.p50ResponseMs / 60000)}m` : "—"}
                sub={analytics.p50ResponseMs ? "Typical response time" : "No replies yet"}
              />
              <StatCard
                label="Leads in range"
                value={String(analytics.inRangeCount)}
                sub={`Last ${range === "today" ? "24h" : range + " days"}`}
              />
              <StatCard
                label="Conversations started"
                value={String(analytics.repliedCount)}
                sub={plan.isPreview ? "Locked actions in Freemium" : "Leads you contacted"}
              />
            </div>
          </div>

          <div className="grid2" style={{ marginTop: 14 }}>
            <div className="card">
              <div style={{ fontWeight: 950 }}>Lead sources (volume)</div>
              <div className="muted" style={{ marginTop: 8 }}>
                This is the fast signal: where your pipeline is actually coming from.
              </div>
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {analytics.sources.length ? (
                  analytics.sources.map((s) => {
                    const max = analytics.sources[0]?.count || 1;
                    const w = Math.max(8, Math.round((s.count / max) * 100));
                    return (
                      <div key={s.source} style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 800 }}>{s.source}</div>
                          <div className="small">{s.count}</div>
                        </div>
                        <div style={{ height: 8, borderRadius: 999, background: "var(--border)" }}>
                          <div style={{ height: 8, width: `${w}%`, borderRadius: 999, background: "var(--text)" }} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="small">No lead sources yet. Add leads or connect a source in Settings.</div>
                )}
              </div>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => router.push("/settings")}>Settings</button>
            </div>

            {plan.isPreview ? (
              <LockedFeature
                title="Advanced reporting (Pro)"
                body="Unlock conversion funnels, source ROI, and 90-day history when you upgrade to Pro."
              />
            ) : (
              <div className="card">
                <div style={{ fontWeight: 950 }}>Follow-up performance</div>
                <div className="muted" style={{ marginTop: 8 }}>
                  When sequences are enabled, this shows which steps get the most replies.
                </div>
                <button className="btn" style={{ marginTop: 12 }} onClick={() => router.push("/settings")}>Review follow-ups</button>
              </div>
            )}
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
