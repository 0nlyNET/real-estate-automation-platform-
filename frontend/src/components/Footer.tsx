export default function Footer() {
  return (
    <footer
      style={{
        marginTop: 26,
        padding: "18px 0 30px",
        borderTop: "1px solid var(--border)",
        color: "var(--muted)",
        fontSize: 13,
      }}
    >
      © {new Date().getFullYear()} RealtyTechAI, LLC. All rights reserved.
    </footer>
  );
}
