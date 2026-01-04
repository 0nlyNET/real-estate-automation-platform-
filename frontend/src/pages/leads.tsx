import { useEffect, useState } from "react";
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
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // If no token, bounce immediately
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError("");

        // Interceptor adds Authorization header automatically
        const res = await api.get("/api/leads");
        const list = normalizeLeads(res.data);

        if (!cancelled) setLeads(list);
      } catch (err: any) {
        const status = err?.response?.status;

        if (status === 401) {
          // token invalid/expired
          logout("/login");
          return;
        }

        const msg =
          err?.response?.data?.message ||
          err?.message ||
          "Failed to load leads";

        if (!cancelled) setError(String(msg));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Leads</h1>

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

      {loading && <p style={{ marginTop: 16 }}>Loading...</p>}

      {!loading && error && (
        <p style={{ marginTop: 16, color: "red" }}>{error}</p>
      )}

      {!loading && !error && (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {leads.length === 0 ? (
            <p>No leads yet.</p>
          ) : (
            leads.map((lead) => {
              const created = safeDateLabel(lead.createdAt);

              return (
                <div
                  key={lead.id}
                  style={{
                    padding: 14,
                    border: "1px solid #e5e5e5",
                    borderRadius: 12,
                    background: "white",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {lead.fullName || "Unnamed Lead"}
                  </div>

                  <div style={{ fontSize: 14, opacity: 0.8 }}>
                    {lead.email ? `Email: ${lead.email}` : "Email: -"}
                    {lead.phone ? ` | Phone: ${lead.phone}` : " | Phone: -"}
                  </div>

                  <div style={{ fontSize: 14, opacity: 0.8 }}>
                    {lead.source ? `Source: ${lead.source}` : "Source: -"}
                    {lead.propertyInterest
                      ? ` | Interest: ${lead.propertyInterest}`
                      : " | Interest: -"}
                  </div>

                  {created && (
                    <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
                      Created: {created}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </main>
  );
}