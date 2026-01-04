import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { login, getToken } from "../lib/auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("admin@test.com");
  const [password, setPassword] = useState("DevPass123!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getToken()) {
      router.replace("/leads");
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await login(email.trim(), password);
      router.push("/leads");
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
        err?.message ||
        "Login failed"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Login</h1>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          required
        />

        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          required
        />

        {error && <div style={{ color: "red" }}>{error}</div>}

        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>
      </form>
    </main>
  );
}