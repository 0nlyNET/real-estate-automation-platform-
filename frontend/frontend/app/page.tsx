import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 980, margin: '64px auto', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>RealtyTechAI</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link
            href="/apply"
            style={{
              textDecoration: 'none',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.15)',
            }}
          >
            Apply
          </Link>
          <Link
            href="/login"
            style={{
              textDecoration: 'none',
              padding: '10px 12px',
              borderRadius: 10,
              background: '#111',
              color: '#fff',
            }}
          >
            Log in
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 46 }}>
        <h1 style={{ fontSize: 44, lineHeight: 1.05, marginBottom: 14 }}>
          Done-for-you real estate automation.
        </h1>
        <p style={{ fontSize: 18, opacity: 0.8, maxWidth: 760 }}>
          Clients apply. You approve. You install the system. No self-signup. Full control.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
          <Link
            href="/apply"
            style={{
              textDecoration: 'none',
              padding: '12px 14px',
              borderRadius: 12,
              background: '#111',
              color: '#fff',
            }}
          >
            Apply now
          </Link>
          <Link
            href="/contact"
            style={{
              textDecoration: 'none',
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid rgba(0,0,0,0.15)',
            }}
          >
            Contact
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 56, opacity: 0.8, fontSize: 14 }}>
        Homepage stays public even if you are logged in. Use the portal via Log in.
      </div>
    </main>
  );
}
