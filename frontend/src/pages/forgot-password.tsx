import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";
import PublicHeader from "../components/PublicHeader";
import Footer from "../components/Footer";
import { requestPasswordReset } from "../lib/auth";
import { friendlyAuthError } from "../lib/friendlyError";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSent(false);

    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (e2) {
      setError(friendlyAuthError(e2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Forgot password | RealtyTech AI</title>
      </Head>

      <main
        style={{
          minHeight: "100vh",
          background:
            "linear-gradient(180deg, var(--bg) 0%, var(--bg) 55%, var(--bg2) 100%)",
        }}
      >
        <div className="container" style={{ paddingBottom: 70 }}>
          <PublicHeader rightCtaLabel="Log in" rightCtaHref="/login" showLogin={false} />

          <div style={{ maxWidth: 520, margin: "24px auto 0" }}>
            <div className="card" style={{ padding: 18 }}>
              <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>Reset your password</h1>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Enter your email and we’ll send you a reset link.
              </p>

              {error ? (
                <div className="alert" style={{ marginTop: 14 }}>
                  {error}
                </div>
              ) : null}

              {sent ? (
                <div className="alertSuccess" style={{ marginTop: 14 }}>
                  If an account exists for that email, a reset link was sent.
                </div>
              ) : null}

              <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Email
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@brokerage.com"
                    autoComplete="email"
                    required
                  />
                </div>

                <button type="submit" className="btnPrimary" disabled={loading}>
                  {loading ? "Sending..." : "Send reset link"}
                </button>

                <div className="small" style={{ textAlign: "center" }}>
                  <Link href="/login" style={{ fontWeight: 800 }}>
                    Back to login
                  </Link>
                </div>
              </form>
            </div>

            <div className="small" style={{ marginTop: 12, textAlign: "center" }}>
              Didn’t get the email? Check spam or try again in a minute.
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <Footer />
          </div>
        </div>
      </main>
    </>
  );
}
