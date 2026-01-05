import Head from "next/head";
import Link from "next/link";
import PublicHeader from "../components/PublicHeader";

export default function Home() {
  return (
    <>
      <Head>
        <title>RealtyTech AI</title>
      </Head>

      <main
        style={{
          minHeight: "100vh",
          background:
            "linear-gradient(180deg, var(--bg) 0%, var(--bg) 55%, var(--bg2) 100%)",
        }}
      >
        <div className="container" style={{ paddingBottom: 70 }}>
          <PublicHeader rightCtaLabel="Sign up" showLogin />

          <section style={{ padding: "34px 0 10px" }}>
            <h1 style={{ fontSize: 46, margin: 0, lineHeight: 1.06, letterSpacing: "-0.02em" }}>
              Reply to new leads in seconds.
              <br />
              Follow up automatically until they respond.
            </h1>

            <p
              style={{
                marginTop: 12,
                maxWidth: 720,
                color: "var(--muted)",
                fontSize: 16,
                lineHeight: 1.6,
              }}
            >
              RealtyTech AI is your agent command center for speed-to-lead, follow-ups, and a clean pipeline view. No
              bloat, no busywork.
            </p>

            <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
              <Link href="/auth/signup" className="btnPrimary">
                Create an agent account
              </Link>

              <Link href="/login" className="btnSecondary">
                Log in
              </Link>

              <Link href="/pricing" className="btnSecondary">
                View pricing
              </Link>
            </div>

            <div style={{ marginTop: 22 }} className="grid2">
              <div className="card cardHover" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Instant response</div>
                <div style={{ color: "var(--muted)", lineHeight: 1.55, fontSize: 14 }}>
                  New lead comes in, they get an instant text and email so you never lose the first touch.
                </div>
              </div>

              <div className="card cardHover" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>No-reply follow-ups</div>
                <div style={{ color: "var(--muted)", lineHeight: 1.55, fontSize: 14 }}>
                  Prebuilt follow-up sequence that stops the moment they reply.
                </div>
              </div>

              <div className="card cardHover" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>One inbox</div>
                <div style={{ color: "var(--muted)", lineHeight: 1.55, fontSize: 14 }}>
                  SMS and email in one place with “Needs reply” so you know exactly what to do next.
                </div>
              </div>

              <div className="card cardHover" style={{ padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Simple pipeline</div>
                <div style={{ color: "var(--muted)", lineHeight: 1.55, fontSize: 14 }}>
                  New, Active, Hot, Under contract, Closed. Clean counts, fast drill-down.
                </div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 900 }}>Built for busy agents</div>
              <div className="muted" style={{ marginTop: 8, maxWidth: 840 }}>
                Every screen answers: “What should I do right now?” Metrics are clickable. Empty states guide you to the
                next action. The rest is automation.
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
