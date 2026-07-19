import type { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  const base = String(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "")
  const paths = ["", "/about", "/apply", "/contact", "/features", "/pricing", "/use-cases", "/privacy", "/terms", "/refund", "/security"]

  return paths.map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/apply" ? 0.9 : 0.6,
  }))
}
