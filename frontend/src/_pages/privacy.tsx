import Head from 'next/head';
import PublicHeader from '../components/PublicHeader';

export default function PrivacyPage() {
  return (
    <>
      <Head>
        <title>Privacy | RealtyTechAI</title>
      </Head>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '0 20px 60px' }}>
        <PublicHeader rightCtaLabel="Sign up" />

        <h1 style={{ fontSize: 34, margin: '20px 0 8px' }}>Privacy Policy</h1>
        <p style={{ margin: 0, opacity: 0.85, maxWidth: 760 }}>
          This is a placeholder Privacy Policy for the MVP. Replace with your final legal text before public launch.
        </p>

        <section
          style={{
            marginTop: 18,
            background: 'white',
            border: '1px solid rgba(15, 23, 42, 0.12)',
            borderRadius: 14,
            padding: 18,
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 18 }}>What we collect</h2>
          <p style={{ opacity: 0.85, lineHeight: 1.6 }}>
            Account information (name, email) and usage data required to operate the service. If you connect messaging
            or CRM tools, we may store configuration details to deliver automations.
          </p>

          <h2 style={{ fontSize: 18 }}>How we use it</h2>
          <p style={{ opacity: 0.85, lineHeight: 1.6 }}>
            To provide the product, improve reliability, and support customers. We do not sell your personal
            information.
          </p>

          <h2 style={{ fontSize: 18 }}>Data safety</h2>
          <p style={{ opacity: 0.85, lineHeight: 1.6, marginBottom: 0 }}>
            We use industry-standard measures to protect data. You should still follow best practices for passwords and
            access.
          </p>
        </section>
      </main>
    </>
  );
}
