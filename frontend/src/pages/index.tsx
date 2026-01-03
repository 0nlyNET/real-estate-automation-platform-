import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>RealtyTechAI</div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/login">Agent Login</Link>
          <a href="#demo">Request Demo</a>
        </div>
      </div>

      <section style={{ marginTop: 56 }}>
        <h1 style={{ fontSize: 44, lineHeight: 1.1, margin: 0 }}>
          Respond to new leads fast, stay organized, and never miss follow ups.
        </h1>
        <p style={{ marginTop: 18, fontSize: 18, color: "#333", maxWidth: 720 }}>
          A lightweight agent dashboard for viewing inquiries and powering automated follow ups. This is the demo version.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
          <Link
            href="/login"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "black",
              color: "white",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Open Agent Demo
          </Link>
          <a
            href="#demo"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              textDecoration: "none",
              fontWeight: 700,
              color: "black",
            }}
          >
            What it does
          </a>
        </div>

        <div
          style={{
            marginTop: 36,
            padding: 18,
            borderRadius: 14,
            border: "1px solid #e5e5e5",
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 800 }}>Demo credentials</div>
          <div style={{ marginTop: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            admin@test.com / DevPass123!
          </div>
          <div style={{ marginTop: 8, color: "#555", fontSize: 14 }}>
            Demo only. Invite-only access is planned.
          </div>
        </div>
      </section>

      <section id="demo" style={{ marginTop: 56 }}>
        <h2 style={{ fontSize: 28, marginBottom: 10 }}>Demo flow</h2>
        <ol style={{ color: "#333", lineHeight: 1.7 }}>
          <li>Agent logs in.</li>
          <li>Agent sees a lead dashboard.</li>
          <li>Each lead has contact info and interest fields.</li>
          <li>Next: automated follow ups and tenant scoping.</li>
        </ol>
      </section>

      <footer style={{ marginTop: 80, paddingTop: 18, borderTop: "1px solid #eee", color: "#666" }}>
        Demo build for agent feedback.
      </footer>
    </main>
  );
}