export function isAdminRole(role?: string | null) {
  const r = String(role || "").toLowerCase();
  return r === "owner" || r === "admin";
}

export function isManagerRole(role?: string | null) {
  const r = String(role || "").toLowerCase();
  return r === "owner" || r === "admin";
}
