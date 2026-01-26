import Head from 'next/head';
import PublicHeader from '../components/PublicHeader';

export default function TermsPage() {
  return (
    <>
      <Head>
        <title>Terms | RealtyTechAI</title>
      </Head>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '0 20px 60px' }}>
        <PublicHeader rightCtaLabel="Sign up" />

        <h1 style={{ fontSize: 34, margin: '20px 0 8px' }}>Terms of Service</h1>
        <p style={{ margin: 0, opacity: 0.85, maxWidth: 760 }}>
          This is a placeholder Terms page for the MVP. Replace with your final legal text before public launch.
        </p>

        <section style={{ marginTop: 18, background: 'white', border: '1px solid rgba(15, 23, 42, 0.12)', borderRadius: 14, padding: 18 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>MVP disclaimer</h2>
          <p style={{ opacity: 0.85, lineHeight: 1.6 }}>
            RealtyTechAI is in active development. Features may change, and availability is not guaranteed.
          </p>

          <h2 style={{ fontSize: 18 }}>Acceptable use</h2>
          <p style={{ opacity: 0.85, lineHeight: 1.6 }}>
            Do not use the product for spam, harassment, or unlawful messaging. You are responsible for compliance with
            local laws, carrier policies, and platform terms when sending messages to leads.
          </p>

          <h2 style={{ fontSize: 18 }}>Contact</h2>
          <p style={{ opacity: 0.85, lineHeight: 1.6, marginBottom: 0 }}>
            Questions? Contact the RealtyTechAI team.
          </p>
        </section>
      </main>
    </>
  );
}
