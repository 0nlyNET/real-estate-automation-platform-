import React from "react";
import { usePlan } from "./PlanContext";
import LockedFeature from "./LockedFeature";
import { formatAgo, formatDuration } from "../lib/time";
import { buildMailtoLink, buildSmsLink, QUICK_REPLIES } from "../lib/quickReplies";

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
  lastContactedAt?: string;
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
  const plan = usePlan();

  if (!props.open || !lead) return null;

  const score = typeof lead.score === "number" ? lead.score : undefined;
const arrivedAgo = lead.createdAt ? formatAgo(lead.createdAt) : "-";
  const repliedAgo = lead.lastContactedAt ? formatAgo(lead.lastContactedAt) : "-";
  const replyMs = lead.lastContactedAt && lead.createdAt
    ? new Date(lead.lastContactedAt).getTime() - new Date(lead.createdAt).getTime()
    : null;

  const urgency = (() => {
    if (!lead.createdAt) return null;
    if (lead.lastContactedAt) return null;
    const ms = Date.now() - new Date(lead.createdAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins >= 120) return { label: "Missed", hint: "Lead is getting cold." };
    if (mins >= 15) return { label: "Delayed", hint: "Faster replies win." };
    return null;
  })();

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
          {/* Speed-to-lead */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 950 }}>Speed-to-lead</div>
                <div className="small" style={{ marginTop: 4 }}>
                  Arrived <b>{arrivedAgo}</b>{" "}
                  {lead.lastContactedAt ? (
                    <>
                      · Replied <b>{repliedAgo}</b>
                    </>
                  ) : (
                    <>
                      · <b>Not replied</b>
                    </>
                  )}
                </div>
              </div>
              {urgency ? <span className="badge">{urgency.label}</span> : null}
            </div>

            <div className="muted" style={{ marginTop: 8 }}>
              {lead.lastContactedAt && typeof replyMs === "number" ? (
                <>First reply in <b>{formatDuration(replyMs)}</b>. Keep this under 5 minutes to win more deals.</>
              ) : plan.isPreview ? (
                <>Freemium is read-only. Upgrade to send a first reply in under 60 seconds.</>
              ) : (
                <>Send a quick first reply to start the conversation. The first 5 minutes matters.</>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button className="btn" type="button" onClick={props.onCall} disabled={!lead.phone}>Call</button>
            <button className="btn" type="button" onClick={props.onText} disabled={!lead.phone || plan.isPreview}>Text</button>
            <button className="btn" type="button" onClick={props.onEmail} disabled={!lead.email || plan.isPreview}>Email</button>
            <button className="btn btnGhost" type="button" onClick={props.onPauseFollowUps}>Pause follow-ups</button>
          </div>

          {/* One-click first reply templates */}
          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900 }}>One-click first reply</div>
            <div className="muted" style={{ marginTop: 6 }}>
              Remove thinking at the moment of response. Customize anytime.
            </div>

            {plan.isPreview ? (
              <div style={{ marginTop: 12 }}>
                <LockedFeature
                  compact
                  title="Replies are locked on Freemium"
                  body="Freemium is a read-only preview. Upgrade to send SMS or email replies instantly."
                />
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              {QUICK_REPLIES.map((t) => {
                const body = t.body({ name: lead.fullName?.split(" ")?.[0] });
                const smsHref = lead.phone ? buildSmsLink(lead.phone, body) : null;
                const emailHref = lead.email ? buildMailtoLink(lead.email, "Quick question", body) : null;
                const disabled = plan.isPreview || (!smsHref && !emailHref);

                return (
                  <button
                    key={t.key}
                    type="button"
                    className="btn btnGhost"
                    disabled={disabled}
                    onClick={() => {
                      const href = smsHref || emailHref;
                      if (href) window.open(href);
                    }}
                    title={body}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {urgency && !lead.lastContactedAt ? (
              <div className="small" style={{ marginTop: 10 }}>
                <b>{urgency.hint}</b> Most agents lose this lead if they wait.
              </div>
            ) : null}
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
