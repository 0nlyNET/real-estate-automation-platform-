import React from "react";

type Lead = {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  leadType?: string;
  temperature?: string;
  stage?: string;
  score?: number;
  source?: string;
  propertyInterest?: string;
  location?: string;
  notes?: string;
  lastActivityAt?: string;
  nextFollowUpAt?: string;
  createdAt?: string;
};

export default function LeadDrawer(props: {
  open: boolean;
  lead: Lead | null;
  onClose: () => void;
  onMoveStage?: (stage: string) => void;
  onPauseFollowUps?: () => void;
  onText?: () => void;
  onEmail?: () => void;
  onCall?: () => void;
}) {
  const lead = props.lead;

  if (!props.open || !lead) return null;

  const score = typeof lead.score === "number" ? lead.score : undefined;

  return (
    <>
      <div className="overlay" onClick={props.onClose} />
      <aside className="drawer" aria-label="Lead details">
        <div className="drawerHeader">
          <div>
            <div style={{ fontWeight: 950, fontSize: 18, lineHeight: 1.2 }}>{lead.fullName || "(Unnamed lead)"}</div>
            <div className="small" style={{ marginTop: 6 }}>
              {lead.leadType ? <span className="badge">{lead.leadType}</span> : null}
              {lead.stage ? <span className="badge" style={{ marginLeft: 8 }}>{lead.stage}</span> : null}
              {typeof score === "number" ? <span className="badge" style={{ marginLeft: 8 }}>Score: {score}</span> : null}
            </div>
          </div>

          <button className="btn btnGhost" type="button" onClick={props.onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div className="drawerBody">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button className="btn" type="button" onClick={props.onCall} disabled={!lead.phone}>Call</button>
            <button className="btn" type="button" onClick={props.onText} disabled={!lead.phone}>Text</button>
            <button className="btn" type="button" onClick={props.onEmail} disabled={!lead.email}>Email</button>
            <button className="btn btnGhost" type="button" onClick={props.onPauseFollowUps}>Pause follow-ups</button>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900 }}>Details</div>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <div className="small">Phone: <strong>{lead.phone || "-"}</strong></div>
              <div className="small">Email: <strong>{lead.email || "-"}</strong></div>
              <div className="small">Source: <strong>{lead.source || "-"}</strong></div>
              <div className="small">Interest: <strong>{lead.propertyInterest || "-"}</strong></div>
              <div className="small">Area: <strong>{lead.location || "-"}</strong></div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900 }}>Automation</div>
            <div className="small" style={{ marginTop: 8 }}>
              Next step: <strong>{lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString() : "Not scheduled"}</strong>
            </div>
            <div className="small" style={{ marginTop: 8 }}>
              Last activity: <strong>{lead.lastActivityAt ? new Date(lead.lastActivityAt).toLocaleString() : "-"}</strong>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900 }}>Move stage</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              {["new", "active", "hot", "under_contract", "closed", "lost"].map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn btnGhost"
                  onClick={() => props.onMoveStage?.(s)}
                >
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          {lead.notes ? (
            <div className="card" style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 900 }}>Notes</div>
              <div className="muted" style={{ marginTop: 8 }}>{lead.notes}</div>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
