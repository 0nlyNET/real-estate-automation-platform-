import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import PublicHeader from "../components/PublicHeader";
import Footer from "../components/Footer";
import { resetPassword } from "../lib/auth";
import { friendlyAuthError } from "../lib/friendlyError";

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = useMemo(() => {
    const t = router.query.token;
    return typeof t === "string" ? t : "";
  }, [router.query.token]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setError("Missing reset token. Please use the link from your email.");
    }
  }, [router.isReady, token]);

  const mismatch = password && confirm && password !== confirm;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Missing reset token. Please use the link from your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (mismatch) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push("/login"), 1200);
    } catch (e2) {
      setError(friendlyAuthError(e2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Set new password | RealtyTech AI</title>
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
              <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>Set a new password</h1>

              {error ? (
                <div className="alert" style={{ marginTop: 14 }}>
                  {error}
                </div>
              ) : null}

              {done ? (
                <div className="alertSuccess" style={{ marginTop: 14 }}>
                  Password updated. Sending you to login…
                </div>
              ) : null}

              <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    New password
                  </label>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div>
                  <label className="small" style={{ display: "block", marginBottom: 6 }}>
                    Confirm password
                  </label>
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                  {mismatch ? (
                    <div className="small" style={{ marginTop: 6 }}>
                      Passwords do not match.
                    </div>
                  ) : null}
                </div>

                <button type="submit" className="btnPrimary" disabled={loading || done}>
                  {loading ? "Updating..." : "Update password"}
                </button>

                <div className="small" style={{ textAlign: "center" }}>
                  <Link href="/login" style={{ fontWeight: 800 }}>
                    Back to login
                  </Link>
                </div>
              </form>
            </div>

            <div className="small" style={{ marginTop: 12, textAlign: "center" }}>
              If this link expired, request a new one{" "}
              <Link href="/forgot-password" style={{ fontWeight: 800 }}>
                here
              </Link>
              .
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
