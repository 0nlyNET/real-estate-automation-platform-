const isProduction = process.env.NODE_ENV === "production"
const isVercelBuild = process.env.VERCEL === "1"

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel packages Next.js through its build adapter. Standalone output is
  // reserved for self-hosted/Docker builds so the platform adapter does not
  // race Next's standalone file-tracing output during onBuildComplete.
  ...(isVercelBuild ? {} : { output: "standalone" }),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          ...(isProduction
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ]
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
