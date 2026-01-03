import { api } from "./api";

export async function login(email: string, password: string) {
  const res = await api.post("/api/auth/login", { email, password });
  const token = res.data.accessToken;
  localStorage.setItem("accessToken", token);
  return token;
}

export function logout() {
  localStorage.removeItem("accessToken");
  window.location.href = "/login";
}

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accessToken");
}