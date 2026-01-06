import React from "react";
import Link from "next/link";

export default function LockedFeature(props: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div
      className="card"
      style={{
        borderStyle: "dashed",
        opacity: 0.95,
        padding: props.compact ? 12 : 16,
      }}
    >
      <div style={{ fontWeight: 950 }}>{props.title}</div>
      <div className="muted" style={{ marginTop: 6 }}>
        {props.body}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="btn" href="/pricing">
          View pricing
        </Link>
        <Link className="btn btnGhost" href="/billing">
          Upgrade inside app
        </Link>
      </div>
    </div>
  );
}
