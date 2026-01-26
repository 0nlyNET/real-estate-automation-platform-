import Head from 'next/head';
import Link from 'next/link';
import PublicHeader from '../components/PublicHeader';

export default function PricingPage() {
  return (
    <>
      <Head>
        <title>Pricing | RealtyTechAI</title>
      </Head>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '0 20px 60px' }}>
        <PublicHeader rightCtaLabel="Sign up" />

        <h1 style={{ fontSize: 34, margin: '20px 0 8px' }}>Pricing</h1>
        <p style={{ margin: 0, opacity: 0.85, maxWidth: 720 }}>
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
          <div
            style={{
              background: 'white',
              border: '1px solid rgba(15, 23, 42, 0.12)',
              borderRadius: 14,
              padding: 18,
            }}
          >
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
            <Link
              href="/auth/signup"
              style={{
                display: 'inline-block',
                marginTop: 14,
                background: '#0f172a',
                color: 'white',
                padding: '10px 14px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Start Starter
            </Link>
          </div>

          <div
            style={{
              background: 'white',
              border: '1px solid rgba(15, 23, 42, 0.12)',
              borderRadius: 14,
              padding: 18,
            }}
          >
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
            <Link
              href="/auth/signup"
              style={{
                display: 'inline-block',
                marginTop: 14,
                border: '1px solid rgba(15, 23, 42, 0.2)',
                padding: '10px 14px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Start Pro
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
