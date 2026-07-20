import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RealtyTechAI",
    short_name: "RealtyTechAI",
    description: "RealtyTechAI managed lead conversion workspace",
    start_url: "/admin/dashboard",
    display: "standalone",
    background_color: "#080b14",
    theme_color: "#2563eb",
    icons: [
      {
        src: "/images/tech-20house-20logo-20with-20circuit-20lines.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
    ],
  }
}
