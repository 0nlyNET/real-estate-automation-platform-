import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { api } from "../lib/api";
import { getToken, logout } from "../lib/auth";

type Lead = {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  source?: string;
  propertyInterest?: string;
  createdAt?: string;
};

function normalizeLeads(payload: any): Lead[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function safeDateLabel(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function LeadsPage() {
  const router = useRouter();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");

  async function fetchLeads() {
    setLoading(true);
    setError("");

    try {
      // IMPORTANT: no /api prefix here
const res = await api.get("/leads");
      const list = normalizeLeads(res.data);
      setLeads(list);
      setLastUpdated(new Date().toLocaleString());
    } catch (err: any) {
      const status = err?.response?.status;

      if (status === 401) {
        logout("/login");
        return;
      }

      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to load leads";

      setError(String(msg));
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

    fetchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) {
      if (l.source) set.add(l.source);
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [leads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return leads.filter((l) => {
      if (sourceFilter !== "all" && (l.source || "") !== sourceFilter) {
        return false;
      }

      if (!q) return true;

      const hay = [
        l.fullName,
        l.email,
        l.phone,
        l.source,
        l.propertyInterest,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [leads, query, sourceFilter]);

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div>
          <div
            onClick={() => router.push("/")}
            style={{
              fontSize: 18,
              fontWeight: 800,
              cursor: "pointer",
              width: "fit-content",
            }}
            title="Go to home"
          >
            RealtyTechAI
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>
            Leads
          </div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
            {lastUpdated ? `Last updated: ${lastUpdated}` : ""}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={fetchLeads}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
              cursor: "pointer",
              background: "white",
            }}
          >
            Refresh
          </button>

          <button
            onClick={() => logout("/login")}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
              cursor: "pointer",
              background: "white",
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          marginTop: 10,
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, phone, source, interest"
          style={{
            flex: "1 1 320px",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            outline: "none",
          }}
        />

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          {sources.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All sources" : s}
            </option>
          ))}
        </select>

        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Showing {filtered.length} of {leads.length}
        </div>
      </div>

      {/* States */}
      {loading && <p style={{ marginTop: 16 }}>Loading...</p>}

      {!loading && error && (
        <p style={{ marginTop: 16, color: "red" }}>{error}</p>
      )}

      {!loading && !error && (
        <div style={{ marginTop: 16 }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 16,
                border: "1px solid #e5e5e5",
                borderRadius: 12,
                background: "white",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                No leads found
              </div>
              <div style={{ marginTop: 6, opacity: 0.8, fontSize: 14 }}>
                If you expected leads, make sure your backend is creating them
                for this tenant.
              </div>
              <button
                onClick={fetchLeads}
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  cursor: "pointer",
                  background: "white",
                }}
              >
                Refresh
              </button>
            </div>
          ) : (
            <div
              style={{
                border: "1px solid #e5e5e5",
                borderRadius: 12,
                overflow: "hidden",
                background: "white",
              }}
            >
              {/* Table header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1.2fr 0.9fr 0.9fr 1fr",
                  gap: 10,
                  padding: 12,
                  fontWeight: 800,
                  fontSize: 12,
                  background: "#fafafa",
                  borderBottom: "1px solid #eee",
                }}
              >
                <div>Name</div>
                <div>Email</div>
                <div>Phone</div>
                <div>Source</div>
                <div>Created</div>
              </div>

              {/* Rows */}
              {filtered.map((lead) => (
                <div
                  key={lead.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1.2fr 0.9fr 0.9fr 1fr",
                    gap: 10,
                    padding: 12,
                    borderBottom: "1px solid #f1f1f1",
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {lead.fullName || "Unnamed Lead"}
                    {lead.propertyInterest ? (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                        Interest: {lead.propertyInterest}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ fontSize: 14, opacity: 0.85 }}>
                    {lead.email || "-"}
                  </div>

                  <div style={{ fontSize: 14, opacity: 0.85 }}>
                    {lead.phone || "-"}
                  </div>

                  <div style={{ fontSize: 14, opacity: 0.85 }}>
                    {lead.source || "-"}
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {safeDateLabel(lead.createdAt) || "-"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}