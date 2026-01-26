import Head from 'next/head';
import Link from 'next/link';
import PublicHeader from '../components/PublicHeader';

export default function Home() {
  return (
    <>
      <Head>
        <title>RealtyTechAI</title>
      </Head>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '0 20px 60px' }}>
        <PublicHeader rightCtaLabel="Sign up" />

        <section style={{ padding: '30px 0 10px' }}>
          <h1 style={{ fontSize: 40, margin: 0, lineHeight: 1.1 }}>Real estate automation that replies fast.</h1>
          <p style={{ marginTop: 12, maxWidth: 680, opacity: 0.85, fontSize: 16 }}>
            RealtyTechAI helps agents capture leads, respond instantly, and follow up automatically with a lightweight
            CRM and messaging workflows.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
            <Link
              href="/auth/signup"
              style={{
                background: '#0f172a',
                color: 'white',
                padding: '10px 14px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Create an agent account
            </Link>
            <Link
              href="/pricing"
              style={{
                border: '1px solid rgba(15, 23, 42, 0.2)',
                padding: '10px 14px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              View pricing
            </Link>
          </div>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 26 }}>
          {[
            { title: 'Speed-to-lead', desc: 'Instant SMS and email with templates and quiet hours.' },
            { title: 'Sequences', desc: 'Follow-ups that adapt to lead type and temperature.' },
            { title: 'CRM and calendar', desc: 'Keep leads organized and schedule meetings faster.' },
          ].map((item) => (
            <div
              key={item.title}
              style={{
                background: 'white',
                border: '1px solid rgba(15, 23, 42, 0.12)',
                borderRadius: 14,
                padding: 16,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16 }}>{item.title}</h3>
              <p style={{ margin: '8px 0 0', opacity: 0.85, fontSize: 14 }}>{item.desc}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
