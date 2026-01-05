import { useEffect, useState } from "react";
import { getStoredTheme, getSystemTheme, setTheme, type Theme } from "../lib/theme";

type Props = {
  size?: "sm" | "md";
};

export default function ThemeToggle({ size = "md" }: Props) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const t = getStoredTheme() ?? getSystemTheme();
    setThemeState(t);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  const pad = size === "sm" ? "8px 10px" : "10px 12px";
  const fontSize = size === "sm" ? 13 : 14;

  return (
    <button
      type="button"
      onClick={toggle}
      style={{
        padding: pad,
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--card)",
        color: "var(--text)",
        fontSize,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      <span style={{ fontSize: fontSize + 2, lineHeight: 1 }}>{theme === "dark" ? "🌙" : "☀️"}</span>
      <span style={{ fontWeight: 600 }}>{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
