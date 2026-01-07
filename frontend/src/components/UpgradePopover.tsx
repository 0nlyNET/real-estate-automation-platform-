import React, { useState } from "react";
import Link from "next/link";

export default function UpgradePopover(props: {
  featureName: string;
  message?: string;
  upgradeHref?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const message = props.message ?? "Upgrade to Pro: $20 more/mo → unlimited sequences";
  const upgradeHref = props.upgradeHref ?? "/pricing#compare";

  return (
    <span className="rtaiUpgWrap" style={{ position: "relative", display: "inline-flex" }}>
      <span
        style={{ display: "inline-flex" }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {props.children}
      </span>

      {open ? (
        <span
          style={{
            position: "absolute",
            top: "100%",
            marginTop: 8,
            right: 0,
            width: 290,
            zIndex: 50,
          }}
        >
          <span className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 900 }}>{props.featureName}</div>
            <div className="muted" style={{ marginTop: 6, lineHeight: 1.35 }}>
              {message}
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link className="btn" href={upgradeHref}>
                View plans
              </Link>
              <Link className="btn btnGhost" href="/plan">
                See my plan
              </Link>
            </div>
          </span>
        </span>
      ) : null}
    </span>
  );
}
