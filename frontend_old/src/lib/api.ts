import axios from "axios";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:4000";

export function isApiConfiguredForProd() {
  if (typeof window === "undefined") return true;
  const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const usingLocalApi = API_BASE_URL.includes("localhost") || API_BASE_URL.includes("127.0.0.1");
  // If the site is not localhost but the API still points to localhost, env is missing on Vercel.
  return isLocalHost || !usingLocalApi;
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach JWT automatically for all requests
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("accessToken");
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});
