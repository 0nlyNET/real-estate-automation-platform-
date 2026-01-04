import axios from "axios";
import { getToken, logout } from "./auth";

const baseURL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) logout();
    return Promise.reject(err);
  }
);