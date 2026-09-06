export function supportReturnPath(value: string | null, platformOperator: boolean, signedIn: boolean) {
  const fallback = signedIn ? (platformOperator ? "/admin/dashboard" : "/app/dashboard") : "/"
  if (!value || value.length > 2000 || /[\\\u0000-\u001f]|%2f|%5c/i.test(value)) return fallback
  if (value.startsWith("/app/") || (platformOperator && value.startsWith("/admin/"))) {
    const url = new URL(value, "https://navigation.invalid")
    if (url.origin === "https://navigation.invalid" &&
        (url.pathname.startsWith("/app/") || (platformOperator && url.pathname.startsWith("/admin/")))) {
      return `${url.pathname}${url.search}`
    }
  }
  return fallback
}
