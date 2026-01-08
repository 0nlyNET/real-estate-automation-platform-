import React from "react";
import Link from "next/link";

type Action = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
};

export default function EmptyState(props: {
  title: string;
  body: React.ReactNode;
  icon?: React.ReactNode;
  primary?: Action;
  secondary?: Action;
}) {
  const { title, body, icon, primary, secondary } = props;

  function renderAction(action: Action) {
    const className = action.variant === "primary" ? "btnPrimary" : "btnSecondary";
    if (action.href) {
      return (
        <Link href={action.href} className={className}>
          {action.label}
        </Link>
      );
    }
    return (
      <button className={className} type="button" onClick={action.onClick}>
        {action.label}
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {icon ? (
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--card2)",
              display: "grid",
              placeItems: "center",
              flex: "0 0 auto",
            }}
          >
            {icon}
          </div>
        ) : null}

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.2 }}>{title}</div>
          <div className="muted" style={{ marginTop: 8, maxWidth: 720 }}>{body}</div>

          {primary || secondary ? (
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              {primary ? renderAction({ ...primary, variant: primary.variant ?? "primary" }) : null}
              {secondary ? renderAction({ ...secondary, variant: secondary.variant ?? "secondary" }) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
