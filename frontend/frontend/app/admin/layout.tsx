import type { ReactNode } from 'react';
import Link from 'next/link';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0b0d10', color: '#e8eef7' }}>
      <aside
        style={{
          width: 260,
          borderRight: '1px solid rgba(255,255,255,0.08)',
          padding: 18,
          position: 'sticky',
          top: 0,
          height: '100vh',
          background: 'rgba(10,12,16,0.9)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 18 }}>RealtyTechAI Admin</div>

        <nav style={{ display: 'grid', gap: 10 }}>
          <Link
            href="/admin"
            style={{
              color: '#e8eef7',
              textDecoration: 'none',
              padding: 10,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
            }}
          >
            Dashboard
          </Link>

          <Link href="/admin/clients" style={{ color: '#e8eef7', textDecoration: 'none', padding: 10, borderRadius: 10 }}>
            Clients
          </Link>

          <Link href="/admin/system" style={{ color: '#e8eef7', textDecoration: 'none', padding: 10, borderRadius: 10 }}>
            System
          </Link>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '12px 0' }} />

          <Link href="/app/dashboard?asClient=1" style={{ color: '#9fb2c8', textDecoration: 'none', padding: 10, borderRadius: 10 }}>
            View client app
          </Link>

          <Link href="/logout" style={{ color: '#9fb2c8', textDecoration: 'none', padding: 10, borderRadius: 10 }}>
            Logout
          </Link>
        </nav>

        <div style={{ position: 'absolute', left: 18, right: 18, bottom: 18, opacity: 0.75, fontSize: 12 }}>
          Owner-only control panel
        </div>
      </aside>

      <main style={{ flex: 1, padding: 28 }}>{children}</main>
    </div>
  );
}
