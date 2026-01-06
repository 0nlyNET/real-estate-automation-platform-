import Head from "next/head";
import Link from "next/link";
import PublicHeader from "../components/PublicHeader";
import Footer from "../components/Footer";
import { getToken } from "../lib/auth";

export default function PricingPage() {
  const loggedIn = Boolean(getToken());

  return (
    <>
      <Head>
        <title>Pricing | RealtyTechAI</title>
      </Head>

      <main className="container">
        <PublicHeader rightCtaLabel={loggedIn ? "Open app" : "Start Free"} />

        <div style={{ marginTop: 22 }}>
          <h1 style={{ fontSize: 40, margin: 0, fontWeight: 950 }}>
            Simple pricing that scales with your pipeline
          </h1>
          <p className="muted" style={{ marginTop: 10, maxWidth: 820, lineHeight: 1.6 }}>
            Start free, upgrade when you need more leads, automations, and analytics.
          </p>
        </div>

        <section
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          {/* Freemium */}
          <div className="card cardHover" style={{ padding: 18 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Freemium</h2>
            <p style={{ margin: "8px 0 0", opacity: 0.85, fontSize: 14 }}>
              For trying the platform and seeing how your pipeline looks.
            </p>
            <div style={{ marginTop: 14, fontSize: 28, fontWeight: 900 }}>$0</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>per month</div>
            <ul style={{ marginTop: 12, paddingLeft: 18, opacity: 0.92, fontSize: 14, lineHeight: 1.7 }}>
              <li>50 leads / month</li>
              <li>1 lead source</li>
              <li>Manual lead entry</li>
              <li><b>Read-only inbox</b></li>
              <li>Basic dashboard (counts only)</li>
              <li>7-day activity history</li>
            </ul>
            <div className="small" style={{ marginTop: 10, opacity: 0.9 }}>
              Replies, automations, and analytics stay visible, but actions are locked.
            </div>
            <Link href={loggedIn ? "/dashboard" : "/auth/signup"} className="btnPrimary" style={{ marginTop: 14, display: "inline-flex" }}>
              Start Free
            </Link>
          </div>

          {/* Starter */}
          <div className="card cardHover" style={{ padding: 18 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Starter</h2>
            <p style={{ margin: "8px 0 0", opacity: 0.85, fontSize: 14 }}>
              For solo agents who want real automation without complexity.
            </p>
            <div style={{ marginTop: 14, fontSize: 28, fontWeight: 900 }}>$69</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>per month</div>
            <ul style={{ marginTop: 12, paddingLeft: 18, opacity: 0.92, fontSize: 14, lineHeight: 1.7 }}>
              <li>1,000 leads / month</li>
              <li>2 lead sources</li>
              <li>Up to 3 active automations</li>
              <li>Email automations</li>
              <li>Basic reporting (lead volume + response time)</li>
              <li>30-day analytics history</li>
              <li>1 user</li>
            </ul>
            <Link href={loggedIn ? "/billing" : "/auth/signup"} className="btnPrimary" style={{ marginTop: 14, display: "inline-flex" }}>
              Start Starter
            </Link>
            <div className="small" style={{ marginTop: 10, opacity: 0.85 }}>
              Upgrade inside the app when you’re ready.
            </div>
          </div>

          {/* Pro */}
          <div className="card cardHover" style={{ padding: 18, borderColor: "rgba(16, 185, 129, 0.35)" }}>
            <div className="badge" style={{ width: "fit-content", marginBottom: 10 }}>
              Most Popular
            </div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Pro</h2>
            <p style={{ margin: "8px 0 0", opacity: 0.85, fontSize: 14 }}>
              For serious agents and small teams running everything through one system.
            </p>
            <div style={{ marginTop: 14, fontSize: 28, fontWeight: 900 }}>$89</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>per month</div>
            <ul style={{ marginTop: 12, paddingLeft: 18, opacity: 0.92, fontSize: 14, lineHeight: 1.7 }}>
              <li>5,000 leads / month</li>
              <li>Unlimited lead sources</li>
              <li>Unlimited automations</li>
              <li>Email + SMS automations</li>
              <li>Advanced workflow logic (stop-on-reply, conditions, delays)</li>
              <li>Advanced reporting (conversion funnel + source ROI)</li>
              <li>90-day analytics history</li>
              <li>Up to 3 users</li>
              <li>Priority support</li>
            </ul>
            <Link href={loggedIn ? "/billing" : "/auth/signup"} className="btnPrimary" style={{ marginTop: 14, display: "inline-flex" }}>
              Go Pro
            </Link>
          </div>

          {/* Enterprise */}
          <div className="card cardHover" style={{ padding: 18 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Enterprise</h2>
            <p style={{ margin: "8px 0 0", opacity: 0.85, fontSize: 14 }}>
              For brokerages and teams that need custom onboarding, roles, and white-label.
            </p>
            <div style={{ marginTop: 14, fontSize: 28, fontWeight: 900 }}>Contact</div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>custom</div>
            <ul style={{ marginTop: 12, paddingLeft: 18, opacity: 0.92, fontSize: 14, lineHeight: 1.7 }}>
              <li>Unlimited leads</li>
              <li>Unlimited users</li>
              <li>Roles and permissions</li>
              <li>White-label branding</li>
              <li>API access + custom reporting</li>
              <li>Dedicated onboarding + SLA options</li>
            </ul>
            <a className="btnSecondary" style={{ marginTop: 14, display: "inline-flex" }} href="mailto:sales@realtytechai.com?subject=Enterprise%20pricing">
              Contact Sales
            </a>
          </div>
        </section>

        <section className="card" style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 950 }}>FAQ</div>
          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900 }}>Can I stay on Freemium?</div>
              <div className="muted" style={{ marginTop: 4 }}>
                Yes. Freemium is unlimited time, with strict usage limits.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 900 }}>What happens if I hit my lead limit?</div>
              <div className="muted" style={{ marginTop: 4 }}>
                New leads pause until next billing cycle or you upgrade.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 900 }}>Can I change plans anytime?</div>
              <div className="muted" style={{ marginTop: 4 }}>
                Yes, upgrade or downgrade anytime.
              </div>
            </div>
          </div>
          {loggedIn ? (
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/billing" className="btn">
                Manage Billing
              </Link>
              <Link href="/dashboard" className="btn btnGhost">
                Back to Dashboard
              </Link>
            </div>
          ) : null}
        </section>

        <Footer />
      </main>
    </>
  );
}
