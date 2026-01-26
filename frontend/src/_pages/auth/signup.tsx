import Head from 'next/head';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type FieldErrors = {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [brokerage, setBrokerage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const errors = useMemo<FieldErrors>(() => {
    const e: FieldErrors = {};
    if (!fullName.trim()) e.fullName = 'Full name is required.';
    if (!email.trim()) e.email = 'Email is required.';
    else if (!isValidEmail(email)) e.email = 'Enter a valid email.';
    if (!password) e.password = 'Password is required.';
    else if (password.length < 8) e.password = 'Use at least 8 characters.';
    if (!confirmPassword) e.confirmPassword = 'Please confirm your password.';
    else if (confirmPassword !== password) e.confirmPassword = 'Passwords do not match.';
    return e;
  }, [fullName, email, password, confirmPassword]);

  const canSubmit = Object.keys(errors).length === 0 && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!canSubmit) {
      setError('Please fix the form errors and try again.');
      return;
    }

    // MVP Step: no backend yet.
    // This is intentionally a placeholder so we can ship UI + validation first.
    setSubmitting(true);
    try {
      await new Promise((r) => setTimeout(r, 500));
      setSuccess('Signup UI is ready. Backend registration will be enabled next.');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Sign up | RealtyTechAI</title>
      </Head>

      <main style={{ maxWidth: 520, margin: '0 auto', padding: '40px 20px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <img src="/favicon-32x32.png" alt="RealtyTechAI" width={28} height={28} style={{ borderRadius: 8 }} />
          <Link href="/" style={{ fontWeight: 700 }}>RealtyTechAI</Link>
        </div>

        <h1 style={{ fontSize: 30, margin: '0 0 6px' }}>Create your agent account</h1>
        <p style={{ margin: 0, opacity: 0.85 }}>
          This is the signup UI for the MVP. Registration will be wired to the backend next.
        </p>

        <form onSubmit={onSubmit} style={{ marginTop: 18, display: 'grid', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Full name</label>
            <input
              value={fullName}
              onChange={(ev) => setFullName(ev.target.value)}
              placeholder="Jane Agent"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(15, 23, 42, 0.2)' }}
              autoComplete="name"
              required
            />
            {errors.fullName && <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>{errors.fullName}</div>}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Email</label>
            <input
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder="you@brokerage.com"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(15, 23, 42, 0.2)' }}
              autoComplete="email"
              inputMode="email"
              required
            />
            {errors.email && <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>{errors.email}</div>}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Brokerage (optional)</label>
            <input
              value={brokerage}
              onChange={(ev) => setBrokerage(ev.target.value)}
              placeholder="Keller Williams, Compass, etc"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(15, 23, 42, 0.2)' }}
              autoComplete="organization"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              placeholder="At least 8 characters"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(15, 23, 42, 0.2)' }}
              autoComplete="new-password"
              required
            />
            {errors.password && <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>{errors.password}</div>}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(ev) => setConfirmPassword(ev.target.value)}
              placeholder="Re-enter password"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(15, 23, 42, 0.2)' }}
              autoComplete="new-password"
              required
            />
            {errors.confirmPassword && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>{errors.confirmPassword}</div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              background: canSubmit ? '#0f172a' : 'rgba(15, 23, 42, 0.35)',
              color: 'white',
              padding: '11px 14px',
              borderRadius: 10,
              fontWeight: 700,
              border: 'none',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Creating account...' : 'Create account'}
          </button>

          {success && (
            <div style={{ padding: 12, borderRadius: 10, background: '#e7f7ee', fontSize: 13 }}>{success}</div>
          )}
          {error && (
            <div style={{ padding: 12, borderRadius: 10, background: '#fdecec', fontSize: 13 }}>{error}</div>
          )}

          <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.85 }}>
            Already have an account?{' '}
            <Link href="/login" style={{ fontWeight: 600 }}>
              Log in
            </Link>
          </p>
        </form>
      </main>
    </>
  );
}
