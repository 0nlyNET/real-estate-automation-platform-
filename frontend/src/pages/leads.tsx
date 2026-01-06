import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import EmptyState from "../components/EmptyState";
import FilterChips from "../components/FilterChips";
import LeadDrawer from "../components/LeadDrawer";
import { api } from "../lib/api";
import { getToken, logout } from "../lib/auth";
import { usePlan } from "../components/PlanContext";
import { formatAgo } from "../lib/time";
import { copy } from "../content/copy";

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
  lastContactedAt?: string;
  nextFollowUpAt?: string;
  createdAt?: string;
  notes?: string;
};

function isToday(d?: string) {
  if (!d) return false;
  const dt = new Date(d);
  const now = new Date();
  return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
}

function fmtRelative(d?: string) {
  if (!d) return "-";
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function scoreLabel(score?: number) {
  if (typeof score !== "number") return undefined;
  if (score >= 80) return "Hot";
  if (score >= 50) return "Warm";
  return "Cold";
}

type LeadForm = {
  fullName: string;
  phone: string;
  email: string;
  leadType: "buyer" | "seller" | "renter" | "investor";
  stage: "new" | "active" | "hot" | "under_contract" | "closed" | "lost";
  source: string;
  location: string;
  propertyInterest: string;
  notes: string;
};

export default function LeadsPage() {
  const router = useRouter();
  const plan = usePlan();
  const { status, stage, open, q, sample } = router.query as Record<string, string | undefined>;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [form, setForm] = useState<LeadForm>({
    fullName: "",
    phone: "",
    email: "",
    leadType: "buyer",
    stage: "new",
    source: "Manual",
    location: "",
    propertyInterest: "",
    notes: "",
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/leads", { params: { take: 200 } });
      setLeads(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      const statusCode = err?.response?.status;
      if (statusCode === 401) {
        logout("/login");
        return;
      }
      setError(String(err?.response?.data?.message || err?.message || "Failed to load leads"));
    } finally {
      setLoading(false);
    }
  }

  async function addSampleLeads() {
    try {
      await api.post("/leads/sample");
      await load();
    } catch (err: any) {
      setError(String(err?.response?.data?.message || err?.message || "Failed to add sample data"));
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

  useEffect(() => {
    if (sample === "1") {
      // from dashboard quick action
      addSampleLeads().finally(() => {
        const next = { ...router.query };
        delete next.sample;
        router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample]);

  useEffect(() => {
    if (!open) return;
    const found = leads.find((l) => l.id === open);
    if (found) {
      setDrawerLead(found);
      setDrawerOpen(true);
    }
  }, [open, leads]);

  const filtered = useMemo(() => {
    let list = [...leads];

    const search = (q || "").trim().toLowerCase();
    if (search) {
      list = list.filter((l) => {
        const hay = [l.fullName, l.phone, l.email, l.location, l.propertyInterest].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(search);
      });
    }

    if (stage) {
      list = list.filter((l) => (l.stage || "new").toLowerCase() === stage.toLowerCase());
    }

    if (status === "new") {
      list = list.filter((l) => isToday(l.createdAt));
    }
    if (status === "followups-due") {
      list = list.filter((l) => l.nextFollowUpAt && isToday(l.nextFollowUpAt));
    }
    if (status === "hot") {
      list = list.filter((l) => (typeof l.score === "number" ? l.score >= 80 : l.temperature === "hot"));
    }

    return list;
  }, [leads, q, stage, status]);

  const chipCounts = useMemo(() => {
    const counts = {
      new: leads.filter((l) => isToday(l.createdAt)).length,
      hot: leads.filter((l) => (typeof l.score === "number" ? l.score >= 80 : l.temperature === "hot")).length,
      followUps: leads.filter((l) => l.nextFollowUpAt && isToday(l.nextFollowUpAt)).length,
    };
    return counts;
  }, [leads]);

  async function createLead() {
    setCreating(true);
    setCreateError("");
    try {
      await api.post("/leads", {
        fullName: form.fullName || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        source: form.source || undefined,
        location: form.location || undefined,
        propertyInterest: form.propertyInterest || undefined,
        leadType: form.leadType,
        temperature: form.stage === "hot" ? "hot" : form.stage === "new" ? "warm" : "cold",
        stage: form.stage,
        notes: form.notes || undefined,
      });
      setShowAdd(false);
      setForm({
        fullName: "",
        phone: "",
        email: "",
        leadType: "buyer",
        stage: "new",
        source: "Manual",
        location: "",
        propertyInterest: "",
        notes: "",
      });
      await load();
    } catch (err: any) {
      setCreateError(String(err?.response?.data?.message || err?.message || "Failed to create lead"));
    } finally {
      setCreating(false);
    }
  }

  async function moveStage(leadId: string, next: string) {
    try {
      await api.patch(`/leads/${leadId}`, { stage: next });
      await load();
    } catch (err: any) {
      setError(String(err?.response?.data?.message || err?.message || "Failed to update lead"));
    }
  }

  function setQuery(next: Record<string, string | undefined>) {
    const merged = { ...router.query, ...next } as Record<string, any>;
    Object.keys(merged).forEach((k) => {
      if (merged[k] === undefined || merged[k] === "") delete merged[k];
    });
    router.push({ pathname: router.pathname, query: merged }, undefined, { shallow: true });
  }

  const chips = useMemo(
    () => [
      { key: "new", label: "New", count: chipCounts.new },
      { key: "hot", label: "Hot", count: chipCounts.hot },
      { key: "followups-due", label: "Follow-ups due", count: chipCounts.followUps },
    ],
    [chipCounts]
  );

  const emptyFiltered = !loading && leads.length > 0 && filtered.length === 0;
  const emptyAll = !loading && leads.length === 0;

  return (
    <AppShell
      title={copy.leads.title}
      subtitle={copy.leads.subtitle}
      right={
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={() => setShowAdd(true)}>
            {copy.global.addLead}
          </button>
          <button className="btn btnGhost" type="button" onClick={addSampleLeads}>
            {copy.global.addSampleData}
          </button>
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

      {!loading ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={(q || "") as string}
              onChange={(e) => setQuery({ q: e.target.value })}
              placeholder="Search name, phone, email, address"
              style={{ flex: "1 1 280px" }}
            />

            <select value={stage || ""} onChange={(e) => setQuery({ stage: e.target.value || undefined })}>
              <option value="">All stages</option>
              <option value="new">New</option>
              <option value="active">Active</option>
              <option value="hot">Hot</option>
              <option value="under_contract">Under contract</option>
              <option value="closed">Closed</option>
              <option value="lost">Lost</option>
            </select>

            <button
              className="btn btnGhost"
              type="button"
              onClick={() => setQuery({ q: undefined, stage: undefined, status: undefined })}
            >
              {copy.global.clearFilters}
            </button>
          </div>

          <div className="muted" style={{ marginTop: 10 }}>
            {copy.leads.helper}
          </div>

          <div style={{ marginTop: 12 }}>
            <FilterChips chips={chips} activeKey={status} onChange={(key) => setQuery({ status: key })} />
          </div>
        </div>
      ) : null}

      {emptyAll ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState
            title={copy.leads.empty.title}
            body={copy.leads.empty.body}
            primary={{ label: copy.leads.empty.primary, onClick: () => setShowAdd(true) }}
            secondary={{ label: copy.leads.empty.secondary, onClick: addSampleLeads }}
          />
        </div>
      ) : null}

      {emptyFiltered ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState
            title={copy.leads.emptyFiltered.title}
            body={copy.leads.emptyFiltered.body}
            primary={{
              label: copy.leads.emptyFiltered.primary,
              onClick: () => setQuery({ q: undefined, stage: undefined, status: undefined }),
            }}
          />
        </div>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
          <div className="tableHead">
            <div>Lead</div>
            <div>Stage</div>
            <div>Status</div>
            <div>Source</div>
            <div>Last activity</div>
            <div>Next step</div>
          </div>

          {filtered.map((l) => {
            const leadScore =
              typeof l.score === "number" ? l.score : l.temperature === "hot" ? 85 : l.temperature === "warm" ? 65 : 40;
            const badge = scoreLabel(leadScore);
            const stageLabel = (l.stage || "new").replace(/_/g, " ");

            let statusLabel = "";
            if (isToday(l.createdAt)) statusLabel = "New";
            else if (l.nextFollowUpAt && isToday(l.nextFollowUpAt)) statusLabel = "Follow-up due";
            else if (leadScore >= 80) statusLabel = "Hot";

            const arrived = l.createdAt ? formatAgo(l.createdAt) : "-";
            const needsReply = !l.lastContactedAt;
            const delayMins = l.createdAt ? Math.floor((Date.now() - new Date(l.createdAt).getTime()) / 60000) : 0;
            const urgency = needsReply && delayMins >= 120 ? "Missed" : needsReply && delayMins >= 15 ? "Delayed" : "";

            return (
              <button
                key={l.id}
                type="button"
                className="tableRow"
                onClick={() => {
                  setDrawerLead(l);
                  setDrawerOpen(true);
                  setQuery({ open: l.id });
                }}
              >
                <div>
                  <div style={{ fontWeight: 900 }}>{l.fullName || "(Unnamed lead)"}</div>
                  <div className="small" style={{ marginTop: 2 }}>
                    {l.leadType ? <span className="badge">{l.leadType}</span> : null}
                    {badge ? (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        {badge}
                      </span>
                    ) : null}
                    <span className="badge" style={{ marginLeft: 8 }}>
                      Arrived {arrived}
                    </span>
                    {urgency ? (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        {urgency}
                      </span>
                    ) : null}
                  </div>
                  {plan.isPreview && needsReply ? (
                    <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                      Replies are locked on Freemium. Upgrade to respond in under 60 seconds.
                    </div>
                  ) : null}
                </div>
                <div className="small" style={{ fontWeight: 800 }}>
                  {stageLabel}
                </div>
                <div className="small">{statusLabel || "-"}</div>
                <div className="small">{l.source || "-"}</div>
                <div className="small">{fmtRelative(l.lastActivityAt || l.createdAt)}</div>
                <div className="small">
                  {l.nextFollowUpAt ? `Follow-up ${new Date(l.nextFollowUpAt).toLocaleDateString()}` : "Not scheduled"}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      <LeadDrawer
        open={drawerOpen}
        lead={drawerLead}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerLead(null);
          const next = { ...router.query };
          delete next.open;
          router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
        }}
        onMoveStage={(s) => drawerLead && moveStage(drawerLead.id, s)}
        onCall={() => drawerLead?.phone && window.open(`tel:${drawerLead.phone}`)}
        onText={() => drawerLead?.phone && window.open(`sms:${drawerLead.phone}`)}
        onEmail={() => drawerLead?.email && window.open(`mailto:${drawerLead.email}`)}
      />

      {showAdd ? (
        <>
          <div className="overlay" onClick={() => setShowAdd(false)} />
          <div className="modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 950, fontSize: 18 }}>Add a lead</div>
                <div className="small" style={{ marginTop: 4 }}>
                  Add someone you’re working right now. Instant responses can run once your number is connected.
                </div>
              </div>
              <button className="btn btnGhost" type="button" onClick={() => setShowAdd(false)}>
                Close
              </button>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
              <div>
                <label className="small" style={{ display: "block", marginBottom: 6 }}>
                  Full name
                </label>
                <input
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                  placeholder="Lead name"
                />
              </div>

              <div className="grid2">
                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Phone
                  </label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="(555) 555-5555"
                  />
                </div>
                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Email
                  </label>
                  <input
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="lead@email.com"
                  />
                </div>
              </div>

              <div className="grid2">
                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Type
                  </label>
                  <select value={form.leadType} onChange={(e) => setForm((f) => ({ ...f, leadType: e.target.value as any }))}>
                    <option value="buyer">Buyer</option>
                    <option value="seller">Seller</option>
                    <option value="renter">Renter</option>
                    <option value="investor">Investor</option>
                  </select>
                </div>
                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Stage
                  </label>
                  <select value={form.stage} onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as any }))}>
                    <option value="new">New</option>
                    <option value="active">Active</option>
                    <option value="hot">Hot</option>
                    <option value="under_contract">Under contract</option>
                    <option value="closed">Closed</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>
              </div>

              <div className="grid2">
                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Source
                  </label>
                  <input value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} placeholder="Facebook / Website / Referral" />
                </div>
                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Area (optional)
                  </label>
                  <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Neighborhood or city" />
                </div>
              </div>

              <div>
                <label className="small" style={{ display: "block", marginBottom: 6 }}>
                  What are they looking for? (optional)
                </label>
                <input
                  value={form.propertyInterest}
                  onChange={(e) => setForm((f) => ({ ...f, propertyInterest: e.target.value }))}
                  placeholder="3 bed condo, listing, rental"
                />
              </div>

              <div>
                <label className="small" style={{ display: "block", marginBottom: 6 }}>
                  Notes (optional)
                </label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Anything important to remember" />
              </div>

              {createError ? (
                <div className="card" style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}>
                  {createError}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button className="btn btnGhost" type="button" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
                <button className="btnPrimary" type="button" disabled={creating || (!form.phone && !form.email)} onClick={createLead}>
                  {creating ? "Adding..." : "Add lead"}
                </button>
              </div>

              <div className="small">{!form.phone && !form.email ? "Add a phone or email so you can message this lead." : ""}</div>
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}