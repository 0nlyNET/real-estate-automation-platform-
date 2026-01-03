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
  if (Array.isArray(payload?.items)) return payload.items; // sometimes APIs use items
  return [];
}

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const run = async () => {
      try {
        setLoading(true);
        setError("");

        const res = await api.get("/api/leads");
        const list = normalizeLeads(res.data);

        setLeads(list);
      } catch (err: any) {
        const status = err?.response?.status;
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          "Failed to load leads";

        setError(msg);

        if (status === 401) {
          logout();
        }
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [router]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Leads</h1>

        <button
          onClick={() => logout()}
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
            leads.map((lead) => (
              <div
                key={lead.id}
                style={{
                  padding: 14,
                  border: "1px solid #e5e5e5",
                  borderRadius: 12,
                  background: "white",
                }}
              >
                <div style={{ fontWeight: 700 }}>{lead.fullName || "Unnamed Lead"}</div>

                <div style={{ fontSize: 14, opacity: 0.8 }}>
                  {lead.email ? `Email: ${lead.email}` : null}
                  {lead.phone ? ` | Phone: ${lead.phone}` : null}
                </div>

                <div style={{ fontSize: 14, opacity: 0.8 }}>
                  {lead.source ? `Source: ${lead.source}` : null}
                  {lead.propertyInterest ? ` | Interest: ${lead.propertyInterest}` : null}
                </div>

                {lead.createdAt && (
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
                    Created: {new Date(lead.createdAt).toLocaleString()}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}