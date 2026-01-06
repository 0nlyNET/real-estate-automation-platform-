import { api } from "./api";

const TOKEN_KEY = "accessToken";

export async function login(email: string, password: string) {
  // IMPORTANT: backend login route is /auth/login (NO /api prefix)
  const res = await api.post("/auth/login", { email, password });

  const token: string | undefined = res.data?.accessToken;
  if (!token) throw new Error("No accessToken returned from backend");

  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
  }

  return token;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function logout(redirectTo: string = "/login") {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  window.location.assign(redirectTo);
}

export async function requestPasswordReset(email: string) {
  const res = await api.post("/auth/forgot-password", { email });
  return res.data;
}

export async function resetPassword(token: string, newPassword: string) {
  const res = await api.post("/auth/reset-password", { token, newPassword });
  return res.data;
}
