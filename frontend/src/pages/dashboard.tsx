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

type Lead = {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  source?: string;
  leadType?: string;
  temperature?: string;
  stage?: string;
  score?: number;
  propertyInterest?: string;
  location?: string;
  lastActivityAt?: string;
  createdAt?: string;
  nextFollowUpAt?: string;
};

function isToday(d?: string) {
  if (!d) return false;
  const dt = new Date(d);
  const now = new Date();
  return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
}

function relativeTime(d?: string) {
  if (!d) return "-";
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [s, l] = await Promise.all([
        api.get("/stats/overview"),
        api.get("/leads", { params: { take: 50 } }),
      ]);
      setStats(s.data);
      setLeads(Array.isArray(l.data) ? l.data : []);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        logout("/login");
        return;
      }
      setError(String(err?.response?.data?.message || err?.message || "Failed to load dashboard"));
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
  }, [router]);

  const todayCounts = useMemo(() => {
    const newLeads = leads.filter((l) => isToday(l.createdAt)).length;
    const followUpsDue = leads.filter((l) => l.nextFollowUpAt && isToday(l.nextFollowUpAt)).length;
    // Messaging backend isn’t wired yet; keep this at 0 until inbox data exists.
    const needsReply = 0;
    return { newLeads, followUpsDue, needsReply };
  }, [leads]);

  const pipeline = useMemo(() => {
    const stages = ["new", "active", "hot", "under_contract", "closed"] as const;
    const counts: Record<string, number> = {};
    stages.forEach((s) => (counts[s] = 0));
    for (const l of leads) {
      const s = (l.stage || "new").toLowerCase();
      if (counts[s] !== undefined) counts[s] += 1;
    }
    return counts;
  }, [leads]);

  const hotLeads = useMemo(() => {
    const scored = leads
      .map((l) => ({
        ...l,
        score: typeof l.score === "number" ? l.score : l.temperature === "hot" ? 85 : l.temperature === "warm" ? 65 : 40,
      }))
      .sort((a, b) => {
        const s = (b.score || 0) - (a.score || 0);
        if (s !== 0) return s;
        return new Date(b.lastActivityAt || b.createdAt || 0).getTime() - new Date(a.lastActivityAt || a.createdAt || 0).getTime();
      });
    return scored.slice(0, 6);
  }, [leads]);

  const showWelcome = !loading && !error && (stats?.totalLeads ?? leads.length) === 0;

  return (
    <AppShell
      title={copy.dashboard.title}
      subtitle={copy.dashboard.subtitle}
      right={
        <button className="btn" type="button" onClick={load}>
          {copy.global.refresh}
        </button>
      }
    >
      {loading ? <div className="muted">Loading...</div> : null}
      {!loading && error ? (
        <div className="card" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
          {error}
        </div>
      ) : null}

      {showWelcome ? (
        <EmptyState
          title={copy.dashboard.welcomeEmpty.title}
          body={copy.dashboard.welcomeEmpty.body}
          primary={{ label: copy.dashboard.welcomeEmpty.primary, href: "/leads" }}
          secondary={{ label: copy.dashboard.welcomeEmpty.secondary, href: "/settings" }}
        />
      ) : null}

      {/* Onboarding checklist */}
      {!loading && !error ? (
        <div className="card" style={{ marginTop: showWelcome ? 14 : 0 }}>
          <div style={{ fontWeight: 950 }}>{copy.dashboard.onboarding.title}</div>
          <div className="muted" style={{ marginTop: 6 }}>
            You can add leads right away. Connect your number and turn on instant responses when you’re ready.
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {(
              [
                {
                  key: "connectNumber",
                  href: "/settings",
                  title: copy.dashboard.onboarding.items.connectNumber.title,
                  body: copy.dashboard.onboarding.items.connectNumber.body,
                  cta: copy.dashboard.onboarding.items.connectNumber.cta,
                },
                {
                  key: "profile",
                  href: "/settings",
                  title: copy.dashboard.onboarding.items.profile.title,
                  body: copy.dashboard.onboarding.items.profile.body,
                  cta: copy.dashboard.onboarding.items.profile.cta,
                },
                {
                  key: "automations",
                  href: "/settings#followups",
                  title: copy.dashboard.onboarding.items.automations.title,
                  body: copy.dashboard.onboarding.items.automations.body,
                  cta: copy.dashboard.onboarding.items.automations.cta,
                },
                {
                  key: "source",
                  href: "/settings#sources",
                  title: copy.dashboard.onboarding.items.source.title,
                  body: copy.dashboard.onboarding.items.source.body,
                  cta: copy.dashboard.onboarding.items.source.cta,
                },
              ] as const
            ).map((i) => (
              <div key={i.key} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div className="badge" style={{ padding: "6px 10px" }}>
                  Step
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 900 }}>{i.title}</div>
                  <div className="small" style={{ marginTop: 4 }}>{i.body}</div>
                </div>
                <button className="btn btnGhost" type="button" onClick={() => router.push(i.href)}>
                  {i.cta}
                </button>
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900 }}>{copy.dashboard.onboarding.items.firstLead.title}</div>
                <div className="small" style={{ marginTop: 4 }}>{copy.dashboard.onboarding.items.firstLead.body}</div>
              </div>
              <button className="btn" type="button" onClick={() => router.push("/leads")}>{copy.dashboard.onboarding.items.firstLead.ctaPrimary}</button>
              <button className="btn btnGhost" type="button" onClick={() => router.push("/leads?sample=1")}>{copy.dashboard.onboarding.items.firstLead.ctaSecondary}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Today */}
      {!loading && !error ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 950 }}>{copy.dashboard.today.title}</div>
              <div className="small" style={{ marginTop: 4 }}>{copy.dashboard.today.micro}</div>
            </div>
          </div>

          <div className="statGrid" style={{ marginTop: 12 }}>
            <StatCard
              label={copy.dashboard.today.tiles.needsReply}
              value={todayCounts.needsReply}
              sub="Goes to Inbox"
              onClick={() => router.push("/inbox?tab=needs-reply")}
            />
            <StatCard
              label={copy.dashboard.today.tiles.followUpsDue}
              value={todayCounts.followUpsDue}
              sub="Goes to Leads"
              onClick={() => router.push("/leads?status=followups-due")}
            />
            <StatCard
              label={copy.dashboard.today.tiles.newLeads}
              value={todayCounts.newLeads}
              sub="Created today"
              onClick={() => router.push("/leads?status=new")}
            />
            <StatCard
              label={copy.dashboard.today.tiles.avgSpeed}
              value="—"
              sub="Coming soon"
              onClick={() => router.push("/reporting")}
            />
          </div>
        </div>
      ) : null}

      {/* Pipeline */}
      {!loading && !error ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 950 }}>{copy.dashboard.pipeline.title}</div>
          <div className="grid2" style={{ marginTop: 12 }}>
            {(
              [
                { key: "new", label: "New" },
                { key: "active", label: "Active" },
                { key: "hot", label: "Hot" },
                { key: "under_contract", label: "Under contract" },
                { key: "closed", label: "Closed" },
              ] as const
            ).map((c) => (
              <button
                key={c.key}
                type="button"
                className="card cardHover"
                onClick={() => router.push(`/leads?stage=${encodeURIComponent(c.key)}`)}
                style={{ textAlign: "left" }}
              >
                <div className="muted">{c.label}</div>
                <div className="h1" style={{ marginTop: 6 }}>{pipeline[c.key] || 0}</div>
                <div className="small" style={{ marginTop: 6 }}>
                  Click to view
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Hot leads */}
      {!loading && !error ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 950 }}>{copy.dashboard.hotLeads.title}</div>
              <div className="small" style={{ marginTop: 4 }}>{copy.dashboard.hotLeads.subtitle}</div>
            </div>
            <button className="btn btnGhost" type="button" onClick={() => router.push("/leads?status=hot")}>View all</button>
          </div>

          {hotLeads.length === 0 ? (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="muted">No hot leads yet. Add a lead and start a conversation.</div>
            </div>
          ) : (
            <div className="card" style={{ marginTop: 12, padding: 0, overflow: "hidden" }}>
              <div style={{ display: "grid" }}>
                {hotLeads.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="listRow"
                    onClick={() => router.push(`/leads?open=${encodeURIComponent(l.id)}`)}
                  >
                    <div>
                      <div style={{ fontWeight: 900 }}>{l.fullName || "(Unnamed lead)"}</div>
                      <div className="small" style={{ marginTop: 2 }}>
                        {l.leadType ? <span className="badge">{l.leadType}</span> : null}
                        {l.propertyInterest ? <span className="badge" style={{ marginLeft: 8 }}>{l.propertyInterest}</span> : null}
                        {l.location ? <span className="badge" style={{ marginLeft: 8 }}>{l.location}</span> : null}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="badge">Score: {l.score ?? (l.temperature === "hot" ? 85 : 65)}</div>
                      <div className="small" style={{ marginTop: 6 }}>Last activity: {relativeTime(l.lastActivityAt || l.createdAt)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </AppShell>
  );
}
