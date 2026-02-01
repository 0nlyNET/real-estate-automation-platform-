import Link from 'next/link';

function Card({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 16,
        padding: 18,
        display: 'block',
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ opacity: 0.78 }}>{desc}</div>
    </Link>
  );
}

export default function AdminHome() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 28, fontWeight: 800 }}>Admin Dashboard</div>
        <div style={{ opacity: 0.78 }}>Manage clients, installs, and system health.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <Card title="Clients" desc="Manage client tenants and users." href="/admin/clients" />
        <Card title="System" desc="View internal system status." href="/admin/system" />
        <Card title="Client App" desc="Open the client dashboard." href="/app/dashboard" />
      </div>
    </div>
  );
}
