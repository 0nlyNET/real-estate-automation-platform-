import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import PublicHeader from "../components/PublicHeader";
import Footer from "../components/Footer";
import { login, getToken } from "../lib/auth";
import { friendlyAuthError } from "../lib/friendlyError";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getToken()) {
      router.replace("/dashboard");
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await login(email.trim(), password);
      router.push("/dashboard");
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Log in | RealtyTech AI</title>
      </Head>

      <main
        style={{
          minHeight: "100vh",
          background:
            "linear-gradient(180deg, var(--bg) 0%, var(--bg) 55%, var(--bg2) 100%)",
        }}
      >
        <div className="container" style={{ paddingBottom: 70 }}>
          <PublicHeader rightCtaLabel="Sign up" showLogin={false} />

          <div style={{ maxWidth: 520, margin: "24px auto 0" }}>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>Log in</h1>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    Jump back in and handle today’s replies and follow-ups.
                  </p>
                </div>
                <Link href="/auth/signup" className="btnSecondary">
                  Create account
                </Link>
              </div>

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

                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Password
                  </label>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    placeholder="Your password"
                    autoComplete="current-password"
                    required
                  />
                </div>

                {error ? (
                  <div
                    className="card"
                    style={{
                      padding: 12,
                      borderColor: "rgba(239, 68, 68, 0.35)",
                      background: "color-mix(in srgb, rgba(239, 68, 68, 0.1) 35%, var(--card))",
                    }}
                  >
                    {error}
                  </div>
                ) : null}

                <button type="submit" className="btnPrimary" disabled={loading}>
                  {loading ? "Signing in..." : "Log in"}
                </button>

                <div className="small">
                  Don’t have an account?{" "}
                  <Link href="/auth/signup" style={{ fontWeight: 800 }}>
                    Sign up
                  </Link>
                </div>

                <div className="small" style={{ textAlign: "center" }}>
                  <Link href="/forgot-password" style={{ fontWeight: 800 }}>
                    Forgot password?
                  </Link>
                </div>
              </form>
            </div>

            <div className="small" style={{ marginTop: 12, textAlign: "center" }}>
              Tip: if you don’t see texts sending yet, connect a business number in Settings.
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <Footer />
          </div>

          <div style={{ marginTop: 24 }}>
            <Footer />
          </div>
        </div>
      </main>
    </>
  );
}
