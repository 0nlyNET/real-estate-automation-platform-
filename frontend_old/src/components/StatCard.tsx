import React from "react";

export default function StatCard(props: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "good" | "warn";
}) {
  const clickable = Boolean(props.onClick);

  return (
    <button
      type="button"
      className="card statCard"
      onClick={props.onClick}
      disabled={!clickable}
      style={{
        textAlign: "left",
        cursor: clickable ? "pointer" : "default",
        opacity: clickable ? 1 : 0.98,
      }}
    >
      <div className="muted" style={{ fontSize: 13 }}>{props.label}</div>
      <div className="h1" style={{ marginTop: 6, fontSize: 26 }}>{props.value}</div>
      {props.sub ? <div className="small" style={{ marginTop: 8 }}>{props.sub}</div> : null}
    </button>
  );
}
