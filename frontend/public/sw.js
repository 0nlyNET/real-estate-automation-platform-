self.addEventListener("push", (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: "RealtyTechAI update", body: "Open the admin workspace to view this update." }
  }
  const requestedUrl = typeof payload.url === "string" ? payload.url : "/admin/dashboard"
  const safeUrl = requestedUrl.startsWith("/admin") && !requestedUrl.startsWith("//")
    ? requestedUrl
    : "/admin/dashboard"
  event.waitUntil(
    self.registration.showNotification(payload.title || "RealtyTechAI update", {
      body: payload.body || "Open the admin workspace to view this update.",
      icon: "/images/tech-20house-20logo-20with-20circuit-20lines.png",
      badge: "/images/tech-20house-20logo-20with-20circuit-20lines.png",
      tag: payload.tag || "realtytechai-update",
      renotify: payload.severity === "critical",
      data: { url: safeUrl },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const requestedUrl = event.notification.data?.url
  const path = typeof requestedUrl === "string" && requestedUrl.startsWith("/admin")
    ? requestedUrl
    : "/admin/dashboard"
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (existing) {
        existing.navigate(path)
        return existing.focus()
      }
      return clients.openWindow(path)
    }),
  )
})
