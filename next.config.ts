import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/** No third-party origins: fonts are self-hosted by next/font, models are
 * same-origin, and there is no analytics. 'wasm-unsafe-eval' is for the
 * meshopt decoder (WebAssembly). 'unsafe-inline' scripts are needed by
 * Next's inline bootstrap without a nonce middleware. Dev mode needs
 * eval for HMR, so the CSP is production-only. */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This folder is the workspace root, even with a package-lock.json in
  // a folder above it.
  outputFileTracingRoot: __dirname,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Share links carry the scene in ?s=; don't leak it cross-origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/models/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
