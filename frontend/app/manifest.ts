import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  const icon = "/images/tech-20house-20logo-20with-20circuit-20lines.png"

  return {
    id: "/",
    name: "RealtyTechAI",
    short_name: "RealtyTechAI",
    description: "Managed real-estate lead response, messaging, appointments, and client operations.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#080b14",
    theme_color: "#2563eb",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    icons: [
      {
        src: icon,
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon,
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
