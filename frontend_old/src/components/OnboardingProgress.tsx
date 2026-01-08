import React from "react";

const steps = [
  { n: 1, label: "Connect leads" },
  { n: 2, label: "Set auto-replies" },
  { n: 3, label: "Watch pipeline fill" },
] as const;

export default function OnboardingProgress(props: { step: 1 | 2 | 3 }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontWeight: 900 }}>Setup progress</div>
        <div className="muted" style={{ fontSize: 12 }}>
          Step {props.step} of 3
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {steps.map((s) => {
          const active = s.n <= props.step;
          return (
            <div
              key={s.n}
              className="card"
              style={{
                padding: 12,
                background: active ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
                borderColor: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.10)",
              }}
            >
              <div className="muted" style={{ fontSize: 12, fontWeight: 900 }}>
                Step {s.n}
              </div>
              <div style={{ marginTop: 4, fontWeight: 800, opacity: active ? 1 : 0.6 }}>{s.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
