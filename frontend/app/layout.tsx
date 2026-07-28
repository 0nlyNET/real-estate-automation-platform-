import type React from "react"
import type { Metadata, Viewport } from "next"
import { Toaster } from "@/components/ui/toaster"
import { ThemeProvider } from "@/components/theme-provider"
import "./globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  applicationName: "RealtyTechAI",
  title: "RealtyTechAI | Managed real-estate lead response",
  description: "Managed lead intake, routing, approved SMS and email follow-up, shared message history, and supervised pilot onboarding.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "RealtyTechAI | Managed real-estate lead response",
    description: "Managed intake, routing, approved follow-up, and supervised launch.",
    type: "website",
    url: "/",
    siteName: "RealtyTechAI",
  },
  icons: {
    icon: "/images/tech-20house-20logo-20with-20circuit-20lines.png",
    apple: "/images/tech-20house-20logo-20with-20circuit-20lines.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "RealtyTechAI",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
