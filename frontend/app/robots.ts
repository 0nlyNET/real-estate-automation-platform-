import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const base = String(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "")
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/app/", "/api/", "/blog", "/login", "/reset-password", "/verify-email", "/accept-invitation"],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
