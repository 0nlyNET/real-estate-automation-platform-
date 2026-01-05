import Head from 'next/head';
import PublicHeader from '../components/PublicHeader';

export default function TermsPage() {
  return (
    <>
      <Head>
        <title>Terms | RealtyTechAI</title>
      </Head>

      <main className="container">
        <PublicHeader rightCtaLabel="Sign up" />

        <h1 style={{ fontSize: 34, margin: '20px 0 8px' }}>Terms of Service</h1>
        <p style={{ margin: 0, color: 'var(--muted)', maxWidth: 760, lineHeight: 1.6 }}>
          This is a placeholder Terms page for the MVP. Replace with your final legal text before public launch.
        </p>

        <section className="card" style={{ marginTop: 18, padding: 18 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>MVP disclaimer</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            RealtyTechAI is in active development. Features may change, and availability is not guaranteed.
          </p>

          <h2 style={{ fontSize: 18 }}>Acceptable use</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            Do not use the product for spam, harassment, or unlawful messaging. You are responsible for compliance with
            local laws, carrier policies, and platform terms when sending messages to leads.
          </p>

          <h2 style={{ fontSize: 18 }}>Contact</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.6, marginBottom: 0 }}>
            Questions? Contact the RealtyTechAI team.
          </p>
        </section>
      </main>
    </>
  );
}
