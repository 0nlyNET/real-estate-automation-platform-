'use client';

import { useState } from 'react';

type LoginResponse = {
  accessToken?: string;
  token?: string;
  message?: string;
};

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function setCookie(name: string, value: string) {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${secure}`;
  } catch {}
}

function storeToken(token: string) {
  try {
    localStorage.setItem('rtai_token', token);
  } catch {}
  setCookie('rtai_token', token);
  setCookie('accessToken', token);
  setCookie('token', token);
}

function isAdminRole(role?: string) {
  const r = (role || '').toLowerCase();
  return r === 'owner' || r === 'admin';
}

function redirectForRole(role?: string) {
  if (isAdminRole(role)) {
    window.location.assign('/admin');
    return;
  }
  window.location.assign('/app/dashboard');
}

export default function LoginPage() {
  const [email, setEmail] = useState('aiautomationsllc@gmail.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch('http://localhost:4000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data: LoginResponse = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setErr(data?.message || 'Login failed');
        return;
      }

      const token = data.accessToken || data.token;
      if (!token) {
        setErr('Login succeeded but no token returned.');
        return;
      }

      storeToken(token);
      const payload = decodeJwtPayload(token);
      redirectForRole(payload?.role);
    } catch (e2: any) {
      setErr(e2?.message || 'Login error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '64px auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 10 }}>Log in</h1>
      <p style={{ marginTop: 0, marginBottom: 20, opacity: 0.8 }}>
        Admins go to /admin. Clients go to /app/dashboard.
      </p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            style={{ padding: 10, borderRadius: 10, border: '1px solid #ddd' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            style={{ padding: 10, borderRadius: 10, border: '1px solid #ddd' }}
          />
        </label>

        {err ? (
          <div style={{ padding: 10, borderRadius: 10, border: '1px solid #f5c2c7', background: '#f8d7da' }}>
            {err}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 12,
            borderRadius: 12,
            border: '1px solid #111',
            background: loading ? '#eee' : '#111',
            color: loading ? '#111' : '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Signing in...' : 'Log in'}
        </button>
      </form>

      <div style={{ marginTop: 14, opacity: 0.8 }}>
        <a href="/" style={{ color: '#111' }}>Back to homepage</a>
      </div>
    </main>
  );
}
