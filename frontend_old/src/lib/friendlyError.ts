import axios from "axios";
import { isApiConfiguredForProd } from "./api";

export function friendlyAuthError(err: unknown): string {
  if (!isApiConfiguredForProd()) {
    return "Configuration error. Contact support.";
  }

  if (axios.isAxiosError(err)) {
    const status = err.response?.status;

    if (status === 401) return "Incorrect email or password.";
    if (status === 429) return "Too many attempts. Please wait a minute and try again.";

    const msg =
      (err.response?.data as any)?.message ||
      (err.response?.data as any)?.error ||
      err.message;

    if (typeof msg === "string" && msg.trim()) {
      if (msg.toLowerCase().includes("network error")) {
        return "Unable to reach server. Please try again.";
      }
      return msg;
    }

    // Axios "Network Error" usually means CORS or bad API URL
    if (err.message?.toLowerCase().includes("network")) {
      return "Unable to reach server. Please try again.";
    }
  }

  return "Something went wrong. Please try again.";
}
