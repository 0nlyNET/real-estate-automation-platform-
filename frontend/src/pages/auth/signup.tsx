import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";

import PublicHeader from "../../components/PublicHeader";
import Footer from "../../components/Footer";
import PasswordField from "../../components/PasswordField";

import { api } from "../../lib/api";
import { friendlyAuthError } from "../../lib/friendlyError";

type FieldErrors = {
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

              {error ? (
                <div
                  className="card"
                  style={{ marginTop: 12, padding: 12, borderColor: "rgba(255,80,80,.25)", background: "rgba(255,80,80,.06)" }}
                >
                  <div style={{ fontWeight: 800 }}>Couldn’t create your account</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {error}
                  </div>
                </div>
              ) : null}

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
                    <PasswordField
                      label="Password"
                      value={password}
                      onChange={setPassword}
                      name="password"
                      placeholder="At least 8 characters"
                    />
                    {fieldErrors.password ? (
                      <div className="muted" style={{ marginTop: 6, color: "rgba(255,180,180,.9)" }}>
                        {fieldErrors.password}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <PasswordField
                      label="Confirm password"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      name="confirmPassword"
                      placeholder="Repeat password"
                    />
                    {fieldErrors.confirmPassword ? (
                      <div className="muted" style={{ marginTop: 6, color: "rgba(255,180,180,.9)" }}>
                        {fieldErrors.confirmPassword}
                      </div>
                    ) : null}
                  </div>
                </div>

                <button type="submit" className="btn" disabled={!canSubmit} style={{ width: "100%" }}>
                  {loading ? "Creating account…" : "Create account"}
                </button>

                <div className="muted" style={{ textAlign: "center" }}>
                  Already have an account?{" "}
                  <Link href="/login" style={{ color: "var(--text)" }}>
                    Log in
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </div>

        <Footer />
      </main>
    </>
  );
}
