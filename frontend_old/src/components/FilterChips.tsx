import React from "react";

export type Chip = {
  key: string;
  label: string;
  count?: number;
};

export default function FilterChips(props: {
  chips: Chip[];
  activeKey?: string;
  onChange: (key?: string) => void;
}) {
  return (
    <div className="chipRow" role="tablist" aria-label="Filters">
      {props.chips.map((c) => {
        const active = props.activeKey === c.key;
        return (
          <button
            key={c.key}
            type="button"
            className={`chip ${active ? "chipActive" : ""}`}
            onClick={() => props.onChange(active ? undefined : c.key)}
          >
            <span>{c.label}</span>
            {typeof c.count === "number" ? <span className="badge" style={{ padding: "4px 8px" }}>{c.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
