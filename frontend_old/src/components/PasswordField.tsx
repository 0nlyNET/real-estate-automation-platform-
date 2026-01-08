import React, { useState } from "react";

export default function PasswordField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  name?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 6 }}>{props.label}</div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 12,
          padding: "10px 12px",
          background: "rgba(0,0,0,0.20)",
        }}
      >
        <input
          name={props.name}
          type={show ? "text" : "password"}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "inherit" }}
        />
        <button className="btn btnGhost" type="button" onClick={() => setShow((s) => !s)} style={{ padding: "8px 10px" }}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}
