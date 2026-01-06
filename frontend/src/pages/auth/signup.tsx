import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import PublicHeader from "../../components/PublicHeader";
import Footer from "../../components/Footer";
import { api } from "../../lib/api";
import { friendlyAuthError } from "../../lib/friendlyError";

type FieldErrors = {
  fullName?: string;
  email?: string;
  brokerage?: string;
  password?: string;
  confirmPassword?: string;
};

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fieldErrors = useMemo<FieldErrors>(() => {
    const errs: FieldErrors = {};
    if (password && password.length < 8) errs.password = "Use 8+ characters";
    if (confirmPassword && confirmPassword !== password) errs.confirmPassword = "Passwords don’t match";
    return errs;
  }, [password, confirmPassword]);

  const canSubmit = !loading && !fieldErrors.password && !fieldErrors.confirmPassword;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError("");
    try {
      await api.post("/auth/register", {
        email: email.trim(),
        password,
        brokerage: brokerage.trim() || undefined,
        fullName: fullName.trim() || undefined,
      });
      router.push("/login");
    } catch (err: any) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Sign up | RealtyTech AI</title>
      </Head>

      <main
        style={{
          minHeight: "100vh",
          background: "linear-gradient(180deg, var(--bg) 0%, var(--bg) 55%, var(--bg2) 100%)",
        }}
      >
        <div className="container" style={{ paddingBottom: 70 }}>
          <PublicHeader rightCtaLabel="Log in" rightCtaHref="/login" showLogin={false} />

          <div style={{ maxWidth: 580, margin: "24px auto 0" }}>
            <div className="card" style={{ padding: 18 }}>
              <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>Create your agent account</h1>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Add a lead and watch instant texting + follow-ups kick in.
              </p>

              <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
                <div className="grid2">
                  <div>
                    <label className="small" style={{ display: "block", marginBottom: 6 }}>
                      Full name
                    </label>
                    <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
                  </div>

                  <div>
                    <label className="small" style={{ display: "block", marginBottom: 6 }}>
                      Brokerage (optional)
                    </label>
                    <input value={brokerage} onChange={(e) => setBrokerage(e.target.value)} placeholder="Company" />
                  </div>
                </div>

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

                <div className="grid2">
                  <div>
                    <label className="small" style={{ display: "block", marginBottom: 6 }}>
                      Password
                    </label>
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      placeholder="8+ characters"
                      autoComplete="new-password"
                      required
                    />
                    {fieldErrors.password ? <div className="small" style={{ marginTop: 6 }}>{fieldErrors.password}</div> : null}
                  </div>

                  <div>
                    <label className="small" style={{ display: "block", marginBottom: 6 }}>
                      Confirm password
                    </label>
                    <input
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      type="password"
                      placeholder="Repeat password"
                      autoComplete="new-password"
                      required
                    />
                    {fieldErrors.confirmPassword ? (
                      <div className="small" style={{ marginTop: 6 }}>{fieldErrors.confirmPassword}</div>
                    ) : null}
                  </div>
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

                <button className="btnPrimary" type="submit" disabled={!canSubmit}>
                  {loading ? "Creating..." : "Create account"}
                </button>

                <div className="small" style={{ marginTop: -2, opacity: 0.9 }}>
                  Freemium is a read-only preview. No credit card required.
                </div>

                <div className="small">
                  Already have an account?{" "}
                  <Link href="/login" style={{ fontWeight: 800 }}>
                    Log in
                  </Link>
                </div>
              </form>
            </div>

            <div className="small" style={{ marginTop: 12, textAlign: "center" }}>
              By creating an account, you agree to the Terms and Privacy Policy.
            </div>

            <div style={{ marginTop: 24 }}>
              <Footer />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
