import Head from 'next/head';
import Link from 'next/link';
import PublicHeader from '../components/PublicHeader';

export default function PricingPage() {
  return (
    <>
      <Head>
        <title>Pricing | RealtyTechAI</title>
      </Head>

      <main className="container">
        <PublicHeader rightCtaLabel="Sign up" />

        <h1 style={{ fontSize: 34, margin: '20px 0 8px' }}>Pricing</h1>
        <p style={{ margin: 0, color: 'var(--muted)', maxWidth: 720, lineHeight: 1.6 }}>
          MVP pricing is simple while we onboard early agents. You can change this later without touching the app
          architecture.
        </p>

        <section
          style={{
            marginTop: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          <div className="card cardHover" style={{ padding: 18 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Starter</h2>
            <p style={{ margin: '8px 0 0', opacity: 0.85, fontSize: 14 }}>
              For solo agents testing speed-to-lead and basic follow-ups.
            </p>
            <div style={{ marginTop: 14, fontSize: 28, fontWeight: 800 }}>$49</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>per month</div>
            <ul style={{ marginTop: 12, paddingLeft: 18, opacity: 0.9, fontSize: 14, lineHeight: 1.7 }}>
              <li>Lead capture and inbox</li>
              <li>Instant response templates</li>
              <li>Basic sequences</li>
            </ul>
            <Link href="/auth/signup" className="btnPrimary" style={{ marginTop: 14, display: 'inline-flex' }}>
              Start Starter
            </Link>
          </div>

          <div className="card cardHover" style={{ padding: 18 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Pro</h2>
            <p style={{ margin: '8px 0 0', opacity: 0.85, fontSize: 14 }}>
              For teams that want more automation, reporting, and CRM workflows.
            </p>
            <div style={{ marginTop: 14, fontSize: 28, fontWeight: 800 }}>$99</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>per month</div>
            <ul style={{ marginTop: 12, paddingLeft: 18, opacity: 0.9, fontSize: 14, lineHeight: 1.7 }}>
              <li>Everything in Starter</li>
              <li>Advanced sequences</li>
              <li>Basic reporting</li>
            </ul>
            <Link href="/auth/signup" className="btnSecondary" style={{ marginTop: 14, display: 'inline-flex' }}>
              Start Pro
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
